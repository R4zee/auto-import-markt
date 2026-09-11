import { query, run } from '../db.js';
import { activeProviders, isKnownSource } from '../providers/index.js';
// (activeProviders für syncAll, isKnownSource für die Bereinigung entfernter Anbieter)
import type { MarketProvider } from '../providers/types.js';
import { listingsRepo, partnersRepo } from '../repositories/listings.js';
import { SEED_PARTNERS } from '../seed/partners.js';

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
    const result = await p.fetchAll();
    await partnersRepo.upsertMany(SEED_PARTNERS);
    if (result.partners?.length) await partnersRepo.upsertMany(result.partners);
    // Marktplatzweit nur Linkslenker
    const lhd = result.listings.filter((l) => l.steering === 'LHD');
    const upserted = await listingsRepo.upsertMany(lhd);
    const deactivated = result.complete ? await listingsRepo.deactivateMissing(p.id, lhd.map((l) => l.id)) : 0;
    const warnings = result.warnings?.length ? result.warnings : undefined;
    if (runId != null) {
      await run('UPDATE sync_runs SET finished_at = ?, status = ?, upserted = ?, deactivated = ?, error = ? WHERE id = ?',
        [new Date().toISOString(), 'ok', upserted, deactivated, warnings ? `warnings: ${warnings.join(' | ')}` : null, runId]);
    }
    return { provider: p.id, status: 'ok', upserted, deactivated, warnings, durationMs: Date.now() - started.getTime() };
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
 * etwa vom eigenen Rechner aus synchronisiert (Cloud-IPs sind gesperrt), auf Vercel ist er aus.
 */
export async function deactivateOrphans(): Promise<Record<string, number>> {
  const counts = await listingsRepo.countBySource();
  const out: Record<string, number> = {};
  for (const source of Object.keys(counts)) {
    if (!isKnownSource(source)) out[source] = await listingsRepo.deactivateMissing(source, []);
  }
  return out;
}

export async function syncAll(): Promise<SyncReport[]> {
  const reports: SyncReport[] = [];
  for (const p of activeProviders()) reports.push(await syncProvider(p));
  const orphans = await deactivateOrphans();
  for (const [source, n] of Object.entries(orphans)) {
    if (n > 0) reports.push({ provider: source, status: 'ok', upserted: 0, deactivated: n, warnings: ['Quelle ohne aktiven Provider – Bestand deaktiviert'], durationMs: 0 });
  }
  return reports;
}

export async function lastRuns(limit = 20): Promise<unknown[]> {
  return query('SELECT * FROM sync_runs ORDER BY id DESC LIMIT ?', [limit]);
}
