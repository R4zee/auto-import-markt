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

  it('Diagnose /api/health/reference: Teilindex und abdeckender Suchindex statt Zeilenzugriffen', async () => {
    assert.match(await plan("SELECT COUNT(*) AS n FROM listings INDEXED BY idx_listings_ref_pending WHERE ref_min_eur IS NULL AND active = 1 AND ref_key <> ''"), /idx_listings_ref_pending/);
    // Angebotsart und Abstand werden im Index geprüft, Zeilen nur für Treffer gelesen (id steht nicht im Index)
    const top = await plan("SELECT id, ref_diff_de FROM listings INDEXED BY idx_listings_search_v3 WHERE active = 1 AND offer_type = 'auction' AND ref_diff_de IS NOT NULL ORDER BY ref_diff_de DESC LIMIT 3");
    assert.match(top, /INDEX idx_listings_search_v3/);
    assert.match(await plan("SELECT COUNT(*) AS n FROM listings INDEXED BY idx_listings_search_v3 WHERE active = 1 AND offer_type = 'auction' AND ref_diff_de IS NOT NULL"), /COVERING INDEX idx_listings_search_v3/);
  });
});
