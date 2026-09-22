import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

process.env.DATABASE_PATH = ':memory:';
delete process.env.TURSO_DATABASE_URL;
delete process.env.DATABASE_URL;
process.env.VERCEL = '';

const { closeDb, query, queryPaged, ready } = await import('../src/db.js');

/**
 * Abfragepläne ohne Tabellenstatistik (der eigene libsql-Server hat keine sqlite_stat1; die Kopie übernimmt sie nicht):
 * der Planer hält `active = 1` für selektiv und nimmt sonst einen (active, …)-Index über alle aktiven Inserate mit
 * Zeilenzugriff je Eintrag – Lauf 47 stand damit 24 Minuten vor dem ersten Schreiben, /api/health/reference brauchte 131 s.
 */
async function plan(sql: string, args: (string | number)[] = []): Promise<string> {
  const rows = await query<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, args);
  return rows.map((r) => r.detail).join(' | ');
}

describe('Abfragepläne: Job- und Diagnoseabfragen laufen über die gedachten Indizes', async () => {
  await ready();
  after(async () => { await closeDb(); });

  it('offene Inserate (Vergleichspreis-Job) über den Teilindex, nicht über alle aktiven Inserate', async () => {
    const p = await plan("SELECT rowid AS __rid, id, ref_key FROM listings INDEXED BY idx_listings_ref_pending WHERE (ref_min_eur IS NULL AND active = 1 AND ref_key <> '') AND rowid > 0 ORDER BY rowid LIMIT 20000");
    assert.match(p, /idx_listings_ref_pending/);
    // Gegenprobe: ohne Zwang wählt der Planer den (active, …)-Index – deshalb erzwingt queryPaged den Teilindex
    const bad = await plan("SELECT id FROM listings WHERE ref_min_eur IS NULL AND active = 1 AND ref_key <> ''");
    assert.match(bad, /idx_listings_active_/);
    assert.deepEqual(await queryPaged('listings', 'id', "ref_min_eur IS NULL AND active = 1 AND ref_key <> ''", [], 20000, 'idx_listings_ref_pending'), []);
  });

  it('queryPaged liest mehr als einen Block vollständig und ohne Wiederholung (rowid rückt vor)', async () => {
    const { run } = await import('../src/db.js');
    await run('CREATE TABLE IF NOT EXISTS paged_probe (v INTEGER NOT NULL)');
    for (let i = 1; i <= 20; i++) await run('INSERT INTO paged_probe(v) VALUES (?)', [i]);
    // 20 Zeilen in Blöcken von 7 → 7, 7, 6; vor der Korrektur (22.09.2026) blieb der rowid-Anker auf 0 stehen und der
    // erste Block kam endlos zurück (Sync: heap out of memory nach 147.000 Encar-Zeilen)
    const rows = await queryPaged<{ v: number }>('paged_probe', 'v', 'v > ?', [0], 7);
    assert.deepEqual(rows.map((r) => Number(r.v)), Array.from({ length: 20 }, (_, i) => i + 1));
    assert.ok(!('__rid' in rows[0]), 'Hilfsspalte entfernt');
    // genau ein voller Block: zweite Abfrage liefert 0 Zeilen und beendet die Schleife
    assert.equal((await queryPaged('paged_probe', 'v', 'v <= ?', [7], 7)).length, 7);
  });

  it('Inserate ohne Bucket-Schlüssel über den ref_key-Index (+active)', async () => {
    assert.match(await plan('SELECT id FROM listings WHERE ref_key IS NULL AND +active = 1 LIMIT 5000'), /idx_listings_ref_key/);
  });

  it('Bestandsabgleich je Quelle über den Quellen-Index in rowid-Reihenfolge, ohne Sortierung', async () => {
    const p = await plan('SELECT rowid AS __rid, id, price, km FROM listings WHERE (source = ? AND +active = 1) AND rowid > ? ORDER BY rowid LIMIT ?', ['encar', 0, 20000]);
    assert.match(p, /idx_listings_source \(source=\? AND rowid>\?\)/);
    assert.doesNotMatch(p, /TEMP B-TREE/);
    // Teilquellen: Gleichheit oder Bereich – beides Indexzugriffe (LIKE wäre keiner)
    const sub = await plan('SELECT DISTINCT source FROM listings WHERE source = ? OR (source >= ? AND source < ?)', ['olx', 'olx-', 'olx.']);
    assert.match(sub, /idx_listings_source/);
    assert.doesNotMatch(sub, /SCAN listings(?! USING)/);
  });

  it('Frische-Prüfung der Buckets abdeckend aus dem Index (key, fetched_at), ohne Zeilen mit Angebots-JSON zu lesen', async () => {
    const p = await plan('SELECT key, fetched_at FROM ref_prices INDEXED BY idx_ref_prices_key_fetched WHERE key > ? ORDER BY key LIMIT 20000', ['']);
    assert.match(p, /COVERING INDEX idx_ref_prices_key_fetched \(key>\?\)/);
    assert.doesNotMatch(p, /TEMP B-TREE/);
  });

  it('Diagnose /api/health/reference: Teilindex und abdeckender Suchindex statt Zeilenzugriffen', async () => {
    assert.match(await plan("SELECT COUNT(*) AS n FROM listings INDEXED BY idx_listings_ref_pending WHERE ref_min_eur IS NULL AND active = 1 AND ref_key <> ''"), /idx_listings_ref_pending/);
    // Auktions-Prüfung nur über die Auktionsmärkte (Marktindex, ~10.000 Zeilen) statt über alle aktiven Einträge des breiten Suchindex
    const auctions = "market IN (?,?,?) AND active = 1 AND offer_type = 'auction' AND ref_diff_de IS NOT NULL";
    assert.match(await plan(`SELECT COUNT(*) AS n FROM listings INDEXED BY idx_listings_market WHERE ${auctions}`, ['US', 'CA', 'JP']), /idx_listings_market \(market=\? AND active=\?\)/);
    assert.match(await plan(`SELECT id, ref_diff_de FROM listings INDEXED BY idx_listings_market WHERE ${auctions} ORDER BY ref_diff_de DESC LIMIT 3`, ['US', 'CA', 'JP']), /idx_listings_market \(market=\? AND active=\?\)/);
  });
});
