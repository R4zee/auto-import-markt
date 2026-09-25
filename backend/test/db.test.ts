import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { isWriteBlocked, dbReadOnly } = await import('../src/db.js');

describe('Datenbank: Schreibsperre von Turso erkennen', () => {
  it('erkennt die Turso-Meldung bei erschöpftem Kontingent, sonst nichts', () => {
    assert.ok(isWriteBlocked(new Error('BLOCKED: Operation was blocked: SQL write operations are forbidden (writes are blocked, do you need to upgrade your plan?)')));
    assert.ok(isWriteBlocked('writes are blocked'));
    assert.ok(!isWriteBlocked(new Error('SQLITE_BUSY: database is locked')));
    assert.ok(!isWriteBlocked(new Error('no such table: listings')));
  });
  it('startet ohne Sperre nicht im Nur-Lese-Modus', () => {
    assert.equal(dbReadOnly(), false);
  });
});

describe('Datenbank: kurze Aussetzer des Servers wiederholen', async () => {
  const { isTransient, withRetries } = await import('../src/db.js');
  it('erkennt Gateway-Fehler und Verbindungsabbrüche, keine SQL-Fehler', () => {
    assert.ok(isTransient(new Error('SERVER_ERROR: Server returned HTTP status 502')));
    assert.ok(isTransient(new Error('fetch failed')));
    assert.ok(isTransient(Object.assign(new Error('TypeError: fetch failed'), { cause: new Error('ECONNRESET') })));
    assert.ok(!isTransient(new Error('SQLITE_ERROR: no such table: listings')));
    assert.ok(!isTransient(new Error('HTTP status 401')));
    // Server antwortet gar nicht (blockierter Schreiber): nicht wiederholen, sonst 4 × Zeitlimit
    const timeout = Object.assign(new Error('Headers Timeout Error'), { name: 'HeadersTimeoutError', code: 'UND_ERR_HEADERS_TIMEOUT' });
    assert.ok(!isTransient(Object.assign(new TypeError('fetch failed'), { cause: timeout })));
  });
  it('wiederholt execute/batch nach einem 502, gibt SQL-Fehler sofort weiter', async () => {
    let calls = 0;
    const fake = {
      execute: async (stmt: unknown) => { calls++; if (calls < 3) throw new Error('SERVER_ERROR: Server returned HTTP status 502'); return { stmt, rows: [] }; },
      batch: async () => { throw new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed'); },
      close: () => undefined,
    };
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      const c = withRetries(fake as never, [1, 1, 1]);
      const r = await c.execute({ sql: 'SELECT 1', args: [] });
      assert.equal(calls, 3);
      assert.deepEqual((r as unknown as { stmt: unknown }).stmt, { sql: 'SELECT 1', args: [] });
      await assert.rejects(c.batch([], 'write'), /UNIQUE constraint/);
      // nach dem letzten Versuch kommt der Fehler durch
      calls = -10;
      await assert.rejects(c.execute('SELECT 1'), /HTTP status 502/);
    } finally {
      console.warn = warn;
    }
  });
});

describe('remoteFetch: Request-Objekt des hrana-Clients an undici weitergeben', async () => {
  const { remoteFetch } = await import('../src/db.js');
  const { createServer } = await import('node:http');
  it('überträgt Adresse, Methode, Kopfzeilen und Rumpf', async () => {
    const server = createServer((req, res) => {
      let data = '';
      req.on('data', (c) => { data += c; });
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ method: req.method, url: req.url, auth: req.headers.authorization, body: data }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const req = new Request(`http://127.0.0.1:${port}/v2/pipeline`, { method: 'POST', headers: { authorization: 'Bearer abc', 'content-type': 'application/json' }, body: '{"x":1}' });
      const res = await remoteFetch(req);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { method: 'POST', url: '/v2/pipeline', auth: 'Bearer abc', body: '{"x":1}' });
      const plain = await remoteFetch(`http://127.0.0.1:${port}/health`);
      assert.equal((await plain.json() as { method: string }).method, 'GET');
    } finally {
      server.close();
    }
  });
});
