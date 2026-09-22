import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createClient } from '@libsql/client';

const { copyDatabase } = await import('../src/services/dbcopy.js');
const { makeKeys, makeToken, verifyToken } = await import('../src/services/libsqlAuth.js');

describe('Datenbank kopieren (Turso → eigener libsql-Server)', () => {
  it('kopiert Tabellen, Zeilen (auch über Blockgrenzen) und Indizes; Wiederholung ändert nichts', async () => {
    const src = createClient({ url: ':memory:' });
    const dst = createClient({ url: ':memory:' });
    await src.executeMultiple(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE listings (id TEXT PRIMARY KEY, make TEXT NOT NULL, price REAL, active INTEGER NOT NULL DEFAULT 1, photos_json TEXT);
      CREATE INDEX idx_listings_make ON listings(make);
      CREATE INDEX idx_listings_pending ON listings(make) WHERE active = 1;
      CREATE TABLE sync_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL);
      INSERT INTO meta VALUES ('ref_key_version', '4');
      INSERT INTO sync_runs(provider) VALUES ('encar'), ('olx');
    `);
    const rows = [];
    for (let i = 0; i < 1234; i++) rows.push({ sql: 'INSERT INTO listings VALUES (?, ?, ?, ?, ?)', args: [`x:${i}`, i % 2 ? 'BMW' : 'Audi', i * 1.5, i % 3 ? 1 : 0, JSON.stringify([`p${i}`])] });
    await src.batch(rows, 'write');

    const log: string[] = [];
    const report = await copyDatabase(src, dst, { batch: 100, log: (l) => log.push(l) });
    assert.deepEqual(report.tables, { listings: 1234, meta: 1, sync_runs: 2 });
    assert.equal(report.indexes, 2);
    assert.equal(Number((await dst.execute('SELECT COUNT(*) AS n FROM listings')).rows[0].n), 1234);
    assert.equal((await dst.execute("SELECT value FROM meta WHERE key = 'ref_key_version'")).rows[0].value, '4');
    assert.equal(Number((await dst.execute('SELECT MAX(id) AS m FROM sync_runs')).rows[0].m), 2);
    const idx = (await dst.execute("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name")).rows;
    assert.deepEqual(idx.map((r) => r.name), ['idx_listings_make', 'idx_listings_pending']);
    assert.match(String(idx[1].sql), /WHERE active = 1/);
    const r = (await dst.execute("SELECT make, price, photos_json FROM listings WHERE id = 'x:7'")).rows[0];
    assert.equal(r.make, 'BMW'); assert.equal(Number(r.price), 10.5); assert.equal(r.photos_json, '["p7"]');

    // wiederholbar (INSERT OR REPLACE, IF NOT EXISTS)
    const again = await copyDatabase(src, dst, { batch: 500, only: ['listings'] });
    assert.deepEqual(again.tables, { listings: 1234 });
    assert.equal(Number((await dst.execute('SELECT COUNT(*) AS n FROM listings')).rows[0].n), 1234);
    // die nächste Kennung nach dem Kopieren folgt der Quelle
    await dst.execute("INSERT INTO sync_runs(provider) VALUES ('copart')");
    assert.equal(Number((await dst.execute('SELECT MAX(id) AS m FROM sync_runs')).rows[0].m), 3);
    src.close(); dst.close();
  });
});

describe('Zugangstoken für den libsql-Server', () => {
  it('EdDSA-JWT mit Ablauf, prüfbar mit dem öffentlichen Schlüssel; roher Schlüssel hat 32 Byte', () => {
    const keys = makeKeys();
    assert.match(keys.publicPem, /^-----BEGIN PUBLIC KEY-----/);
    assert.equal(Buffer.from(keys.publicRaw, 'base64url').length, 32);
    const token = makeToken(keys.privatePem, 30);
    const [h] = token.split('.');
    assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url').toString()), { alg: 'EdDSA', typ: 'JWT' });
    const v = verifyToken(token, keys.publicPem);
    assert.ok(v.valid);
    assert.ok(Number(v.payload?.exp) - Number(v.payload?.iat) === 30 * 86400);
    assert.ok(!verifyToken(token, makeKeys().publicPem).valid, 'anderer Schlüssel → ungültig');
    assert.ok(!verifyToken(makeToken(keys.privatePem, -1), keys.publicPem).valid, 'abgelaufen → ungültig');
  });
});
