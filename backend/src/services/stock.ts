import { query } from '../db.js';

/**
 * Bestandsdiagnose für /api/health/stock (07.10.2026): Alter und Dubletten im aktiven Bestand je Quelle, nur lesend.
 * Grundlage für die Bereinigung („voll mit doppelten und alten Inseraten“), ohne Datenbankzugang vom eigenen Rechner.
 *
 * - `sources`: je Quelle Zeilen gesamt/aktiv, ältester und jüngster Abruf aktiver Inserate und wie viele aktive Inserate
 *   älter als 1/3/7/14 Tage sind. Ein Inserat bekommt `fetched_at` nur beim Schreiben (neu oder Preis/km geändert) –
 *   unveränderte Inserate altern also, auch wenn die Quelle sie noch führt (bis zum Nachführen durch den Sync).
 * - `duplicates.withinSource`: Gruppen gleicher (Marke, Modell, Baujahr, km, Preis) innerhalb einer Quelle – meist neu
 *   eingestellte Anzeigen desselben Fahrzeugs unter neuer ID, deren alte ID nie deaktiviert wurde.
 * - `duplicates.acrossSources`: gleiche (Marke, Modell, Baujahr, km > 0) in mehreren Quellen – Quellenpaare, die
 *   denselben Markt doppelt liefern (z. B. zwei Zugänge zu Copart oder Dubizzle).
 * - `lastOkRuns`: letzter erfolgreicher Sync je Provider aus sync_runs.
 *
 * Alle Teile laufen in einem Durchgang über die aktiven Zeilen (~310.000) bzw. den Quellen-Index; `timingsMs` je Teil.
 */
export interface StockReport {
  sources: Array<{ source: string; total: number; active: number; oldest: string | null; newest: string | null; olderThan: { d1: number; d3: number; d7: number; d14: number } }>;
  duplicates: {
    withinSource: Array<{ source: string; groups: number; extra: number }>;
    withinSourceExamples: Array<{ source: string; make: string; model: string; year: number; km: number; price: number; n: number; firstId: string; lastId: string; firstFetched: string; lastFetched: string }>;
    acrossSources: Array<{ pair: string; groups: number; extra: number }>;
    acrossSourcesExamples: Array<{ make: string; model: string; year: number; km: number; n: number; sources: string }>;
  };
  lastOkRuns: Record<string, string>;
  cutoffs: { d1: string; d3: string; d7: string; d14: string };
  timingsMs: Record<string, number>;
  time: string;
}

export async function stockReport(now = new Date()): Promise<StockReport> {
  const cut = (days: number) => new Date(now.getTime() - days * 86400000).toISOString();
  const cutoffs = { d1: cut(1), d3: cut(3), d7: cut(7), d14: cut(14) };
  const timingsMs: Record<string, number> = {};
  const timed = async <T>(label: string, p: Promise<T>): Promise<T> => { const t = Date.now(); const v = await p; timingsMs[label] = Date.now() - t; return v; };
  const n = (v: unknown) => Number(v ?? 0);

  const older = (col: string) => `SUM(CASE WHEN active = 1 AND fetched_at < ? THEN 1 ELSE 0 END) AS ${col}`;
  const [sources, within, withinExamples, across, acrossExamples, runs] = await Promise.all([
    // Quellen-Index in Indexreihenfolge → GROUP BY ohne Sortierung; ohne Statistik wählte der Planer sonst einen (active, …)-Index
    timed('sources', query<{ source: string; total: number; active: number; oldest: string | null; newest: string | null; d1: number; d3: number; d7: number; d14: number }>(
      `SELECT source, COUNT(*) AS total, SUM(active) AS active,
         MIN(CASE WHEN active = 1 THEN fetched_at END) AS oldest, MAX(CASE WHEN active = 1 THEN fetched_at END) AS newest,
         ${older('d1')}, ${older('d3')}, ${older('d7')}, ${older('d14')}
       FROM listings INDEXED BY idx_listings_source GROUP BY source ORDER BY active DESC`,
      [cutoffs.d1, cutoffs.d3, cutoffs.d7, cutoffs.d14])),
    timed('withinSource', query<{ source: string; groups: number; extra: number }>(
      `SELECT source, COUNT(*) AS groups, SUM(n) - COUNT(*) AS extra FROM (
         SELECT source, COUNT(*) AS n FROM listings WHERE active = 1 GROUP BY source, make, model, year, km, price HAVING COUNT(*) > 1
       ) GROUP BY source ORDER BY extra DESC`)),
    timed('withinSourceExamples', query<{ source: string; make: string; model: string; year: number; km: number; price: number; n: number; first_id: string; last_id: string; first_fetched: string; last_fetched: string }>(
      `SELECT source, make, model, year, km, price, COUNT(*) AS n, MIN(external_id) AS first_id, MAX(external_id) AS last_id,
         MIN(fetched_at) AS first_fetched, MAX(fetched_at) AS last_fetched
       FROM listings WHERE active = 1 GROUP BY source, make, model, year, km, price HAVING COUNT(*) > 1 ORDER BY n DESC, last_fetched DESC LIMIT 12`)),
    timed('acrossSources', query<{ pair: string; groups: number; extra: number }>(
      `SELECT s1 || ' + ' || s2 AS pair, COUNT(*) AS groups, SUM(n) - COUNT(*) AS extra FROM (
         SELECT MIN(source) AS s1, MAX(source) AS s2, COUNT(*) AS n FROM listings WHERE active = 1 AND km > 0
         GROUP BY make, model, year, km HAVING COUNT(DISTINCT source) > 1
       ) GROUP BY s1, s2 ORDER BY extra DESC LIMIT 15`)),
    timed('acrossSourcesExamples', query<{ make: string; model: string; year: number; km: number; n: number; sources: string }>(
      `SELECT make, model, year, km, COUNT(*) AS n, GROUP_CONCAT(source, ', ') AS sources FROM listings WHERE active = 1 AND km > 0
       GROUP BY make, model, year, km HAVING COUNT(DISTINCT source) > 1 ORDER BY n DESC LIMIT 10`)),
    timed('lastOkRuns', query<{ provider: string; last: string }>("SELECT provider, MAX(finished_at) AS last FROM sync_runs WHERE status = 'ok' GROUP BY provider")),
  ]);

  return {
    sources: sources.map((r) => ({ source: r.source, total: n(r.total), active: n(r.active), oldest: r.oldest, newest: r.newest, olderThan: { d1: n(r.d1), d3: n(r.d3), d7: n(r.d7), d14: n(r.d14) } })),
    duplicates: {
      withinSource: within.map((r) => ({ source: r.source, groups: n(r.groups), extra: n(r.extra) })),
      withinSourceExamples: withinExamples.map((r) => ({ source: r.source, make: r.make, model: r.model, year: n(r.year), km: n(r.km), price: n(r.price), n: n(r.n), firstId: r.first_id, lastId: r.last_id, firstFetched: r.first_fetched, lastFetched: r.last_fetched })),
      acrossSources: across.map((r) => ({ pair: r.pair, groups: n(r.groups), extra: n(r.extra) })),
      acrossSourcesExamples: acrossExamples.map((r) => ({ make: r.make, model: r.model, year: n(r.year), km: n(r.km), n: n(r.n), sources: r.sources })),
    },
    lastOkRuns: Object.fromEntries(runs.map((r) => [r.provider, r.last])),
    cutoffs,
    timingsMs,
    time: now.toISOString(),
  };
}
