import { one, query, run } from '../db.js';
import { activeProviders, isKnownSource } from '../providers/index.js';
import type { Listing } from '../domain/types.js';
import type { MarketProvider } from '../providers/types.js';
import { listingsRepo, partnersRepo } from '../repositories/listings.js';
import { SEED_PARTNERS } from '../seed/partners.js';
import { refreshFacets } from './facets.js';
import { fxSync, getFx } from './fx.js';

export interface SyncReport {
  provider: string;
  status: 'ok' | 'error';
  upserted: number;
  deactivated: number;
  error?: string;
  /** Nicht-fatale Hinweise, z. B. gedrosselte Teilquellen */
  warnings?: string[];
  durationMs: number;
}

export async function syncProvider(p: MarketProvider): Promise<SyncReport> {
  const started = new Date();
  const ins = await run('INSERT INTO sync_runs(provider, started_at, status) VALUES (?, ?, ?)', [p.id, started.toISOString(), 'running']);
  const runId = ins.lastInsertRowid == null ? null : Number(ins.lastInsertRowid);
  try {
    await getFx(); // Kurse für die vorberechneten EUR-/Endpreis-Spalten
    const result = await p.fetchAll();
    await partnersRepo.upsertMany(SEED_PARTNERS);
    if (result.partners?.length) await partnersRepo.upsertMany(result.partners);
    // Marktplatzweit nur Linkslenker; doppelte IDs (z. B. beworbene OLX-Anzeigen auf mehreren Seiten) einmal nehmen
    const byId = new Map<string, Listing>();
    for (const l of result.listings) if (l.steering === 'LHD') byId.set(l.id, l);
    const lhd = [...byId.values()];
    const duplicates = result.listings.filter((l) => l.steering === 'LHD').length - lhd.length;
    // Nur neue oder geänderte Inserate schreiben (Preis/km) – spart bei großen Beständen den Großteil der Schreibvorgänge.
    // Teilquellen des Providers zählen mit (olx → olx-pl/-ro/-bg/-pt, autoapi → autoapi-dubizzle …).
    const existing = await listingsRepo.activeIdsBySource(p.id, true);
    const changed = lhd.filter((l) => {
      const e = existing.get(l.id);
      return !e || e.price !== l.price || e.km !== l.km;
    });
    const upserted = await listingsRepo.upsertMany(changed);
    const deactivated = result.complete ? await listingsRepo.deactivateMissing(p.id, lhd.map((l) => l.id), true) : 0;
    const warnings = [...(result.warnings ?? [])];
    if (duplicates > 0) warnings.push(`${duplicates} Duplikate zusammengeführt`);
    if (lhd.length !== changed.length) warnings.push(`${lhd.length - changed.length} unverändert übersprungen`);
    if (runId != null) {
      await run('UPDATE sync_runs SET finished_at = ?, status = ?, upserted = ?, deactivated = ?, error = ? WHERE id = ?',
        [new Date().toISOString(), 'ok', upserted, deactivated, warnings.length ? `warnings: ${warnings.join(' | ')}` : null, runId]);
    }
    return { provider: p.id, status: 'ok', upserted, deactivated, warnings: warnings.length ? warnings : undefined, durationMs: Date.now() - started.getTime() };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (runId != null) {
      await run('UPDATE sync_runs SET finished_at = ?, status = ?, error = ? WHERE id = ?', [new Date().toISOString(), 'error', msg, runId]);
    }
    return { provider: p.id, status: 'error', upserted: 0, deactivated: 0, error: msg, durationMs: Date.now() - started.getTime() };
  }
}

/**
 * Deaktiviert Listings von Quellen, für die es keinen Provider mehr gibt (z. B. nach dem
 * Entfernen eines Anbieters). Lediglich abgeschaltete Provider bleiben unangetastet: Encar wird
 * etwa per GitHub Actions synchronisiert, auf Vercel ist der Provider aus.
 */
export async function deactivateOrphans(): Promise<Record<string, number>> {
  const counts = await listingsRepo.countBySource();
  const out: Record<string, number> = {};
  for (const source of Object.keys(counts)) {
    if (!isKnownSource(source)) out[source] = await listingsRepo.deactivateMissing(source, []);
  }
  return out;
}

/** EUR-/Endpreis-Spalten neu berechnen, wenn sich der Kursstand seit dem letzten Mal geändert hat. */
export async function recomputeDerivedIfFxChanged(): Promise<number> {
  const asOf = fxSync().asOf;
  if (!asOf || asOf === 'fallback') return 0;
  const last = await one<{ value: string }>("SELECT value FROM meta WHERE key = 'derived_fx_as_of'");
  if (last?.value === asOf) return 0;
  const n = await listingsRepo.recomputeDerived();
  await run("INSERT INTO meta(key, value) VALUES ('derived_fx_as_of', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [asOf]);
  return n;
}

export async function syncAll(): Promise<SyncReport[]> {
  const reports: SyncReport[] = [];
  for (const p of activeProviders()) reports.push(await syncProvider(p));
  const orphans = await deactivateOrphans();
  for (const [source, n] of Object.entries(orphans)) {
    if (n > 0) reports.push({ provider: source, status: 'ok', upserted: 0, deactivated: n, warnings: ['Quelle ohne aktiven Provider – Bestand deaktiviert'], durationMs: 0 });
  }
  const t0 = Date.now();
  const recomputed = await recomputeDerivedIfFxChanged();
  if (recomputed > 0) reports.push({ provider: 'fx-recompute', status: 'ok', upserted: recomputed, deactivated: 0, warnings: ['Endpreise mit neuem Kursstand neu berechnet'], durationMs: Date.now() - t0 });
  // Filterlisten/Marktzähler einmal je Lauf vorberechnen – die Suche liest sie dann aus `meta`
  const t1 = Date.now();
  const facets = await refreshFacets();
  reports.push({ provider: 'facets', status: 'ok', upserted: facets.makes.length, deactivated: 0, warnings: [`${facets.total} aktive Inserate, ${facets.makes.length} Marken, ${facets.locations.length} Standorte`], durationMs: Date.now() - t1 });
  return reports;
}

export async function lastRuns(limit = 20): Promise<unknown[]> {
  return query('SELECT * FROM sync_runs ORDER BY id DESC LIMIT ?', [limit]);
}
