import { query, run } from '../db.js';
import { activeProviders } from '../providers/index.js';
import type { MarketProvider } from '../providers/types.js';
import { listingsRepo, partnersRepo } from '../repositories/listings.js';
import { SEED_PARTNERS } from '../seed/partners.js';

export interface SyncReport {
  provider: string;
  status: 'ok' | 'error';
  upserted: number;
  deactivated: number;
  error?: string;
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
    if (runId != null) {
      await run('UPDATE sync_runs SET finished_at = ?, status = ?, upserted = ?, deactivated = ? WHERE id = ?', [new Date().toISOString(), 'ok', upserted, deactivated, runId]);
    }
    return { provider: p.id, status: 'ok', upserted, deactivated, durationMs: Date.now() - started.getTime() };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (runId != null) {
      await run('UPDATE sync_runs SET finished_at = ?, status = ?, error = ? WHERE id = ?', [new Date().toISOString(), 'error', msg, runId]);
    }
    return { provider: p.id, status: 'error', upserted: 0, deactivated: 0, error: msg, durationMs: Date.now() - started.getTime() };
  }
}

export async function syncAll(): Promise<SyncReport[]> {
  const reports: SyncReport[] = [];
  for (const p of activeProviders()) reports.push(await syncProvider(p));
  return reports;
}

export async function lastRuns(limit = 20): Promise<unknown[]> {
  return query('SELECT * FROM sync_runs ORDER BY id DESC LIMIT ?', [limit]);
}
