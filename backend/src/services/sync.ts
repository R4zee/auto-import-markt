import { one, query, run, searchTextSql } from '../db.js';
import { canonicalMake } from '../domain/makes.js';
import type { Listing } from '../domain/types.js';
import { activeProviders, isKnownSource } from '../providers/index.js';
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
    await partnersRepo.upsertMany(SEED_PARTNERS);
    // Nur neue oder geänderte Inserate schreiben (Preis/km) – spart bei großen Beständen den Großteil der Schreibvorgänge.
    // Teilquellen des Providers zählen mit (olx → olx-pl/-ro/-bg/-pt, autoapi → autoapi-dubizzle …).
    const existing = await listingsRepo.activeIdsBySource(p.id, true);
    const normalize = (l: Listing): Listing => ({ ...l, make: canonicalMake(l.make) || l.make });
    const isChanged = (l: Listing) => { const e = existing.get(l.id); return !e || e.price !== l.price || e.km !== l.km; };
    // Zwischenstände (Encar-Teilabfragen, Copart-Seiten, Preisfenster …) sofort schreiben – Ergebnisse sind dann schon
    // während des Laufs sichtbar. Die am Ende zurückgegebene Gesamtliste zählt nur noch das, was nicht bereits geschrieben ist.
    const written = new Set<string>();
    let upserted = 0;
    const result = await p.fetchAll({
      onBatch: async (batch) => {
        const fresh = batch.filter((l) => l.steering === 'LHD' && !written.has(l.id)).map(normalize).filter(isChanged);
        for (const l of fresh) written.add(l.id);
        upserted += await listingsRepo.upsertMany(fresh);
      },
    });
    if (result.partners?.length) await partnersRepo.upsertMany(result.partners);
    // Marktplatzweit nur Linkslenker; doppelte IDs (z. B. beworbene OLX-Anzeigen auf mehreren Seiten) einmal nehmen;
    // Markennamen quellenübergreifend vereinheitlichen (sonst Dubletten im Markenfilter)
    const byId = new Map<string, Listing>();
    for (const l of result.listings) if (l.steering === 'LHD') byId.set(l.id, normalize(l));
    const lhd = [...byId.values()];
    const duplicates = result.listings.filter((l) => l.steering === 'LHD').length - lhd.length;
    const changed = lhd.filter((l) => !written.has(l.id) && isChanged(l));
    upserted += await listingsRepo.upsertMany(changed);
    const deactivated = result.complete ? await listingsRepo.deactivateMissing(p.id, lhd.map((l) => l.id), true) : 0;
    const warnings = [...(result.warnings ?? [])];
    if (duplicates > 0) warnings.push(`${duplicates} Duplikate zusammengeführt`);
    if (lhd.length !== upserted) warnings.push(`${lhd.length - upserted} unverändert übersprungen`);
    if (written.size) warnings.push(`${written.size} bereits während des Ladens geschrieben`);
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

/** Stand der Endpreis-Kalkulation (Gebühren, Versicherungssätze) – hochzählen, wenn sich calcLandedCost/FEES ändern */
const LANDED_VERSION = '2';

/** Kursabweichung, ab der die vorberechneten Endpreise einer Währung neu geschrieben werden (0,5 %) */
export const FX_RECOMPUTE_THRESHOLD = 0.005;

interface AppliedFx { version: string; rates: Record<string, number> }

/**
 * Welche Währungen neu gerechnet werden müssen: alle, wenn sich die Kalkulation geändert hat oder noch kein Stand
 * gespeichert ist; sonst nur die, deren Kurs seit dem letzten Schreiben um mindestens FX_RECOMPUTE_THRESHOLD abweicht.
 */
export function currenciesToRecompute(current: Record<string, number>, applied: AppliedFx | null): string[] | 'all' {
  if (!applied || applied.version !== LANDED_VERSION) return 'all';
  return Object.entries(current)
    .filter(([ccy, rate]) => ccy !== 'EUR' && (applied.rates[ccy] == null || Math.abs(rate / applied.rates[ccy] - 1) >= FX_RECOMPUTE_THRESHOLD))
    .map(([ccy]) => ccy);
}

/**
 * EUR-/Endpreis-Spalten neu berechnen – nur für Währungen, deren Kurs seit dem letzten Schreiben spürbar abweicht
 * (FX_RECOMPUTE_THRESHOLD), oder komplett nach einer Kalkulationsänderung (LANDED_VERSION). Bis 22.09.2026 schrieb jeder
 * Sync nach dem täglichen EZB-Kurs alle ~200.000 Zeilen samt sechs Indizes neu (Lauf 59: 197.029 Zeilen, 21 min) – der
 * größte Posten im Turso-Schreibkontingent, das am 21. und 22.09.2026 erschöpft war. Die Website rechnet den angezeigten
 * Endpreis ohnehin live mit dem Tageskurs; die Spalten dienen Sortierung und Filter, dort ist < 0,5 % Drift unerheblich.
 * Gespeichert wird je Währung der zuletzt angewandte Kurs (`derived_fx_rates`); der alte Tagesstempel `derived_fx_as_of`
 * wird einmalig als „Spalten sind aktuell“ übernommen, damit die Umstellung selbst keinen Volldurchlauf auslöst.
 */
export async function recomputeDerivedIfFxChanged(): Promise<number> {
  const fx = fxSync();
  if (!fx.asOf || fx.asOf === 'fallback') return 0;
  const stored = await one<{ value: string }>("SELECT value FROM meta WHERE key = 'derived_fx_rates'");
  let applied: AppliedFx | null = null;
  try { applied = stored ? (JSON.parse(stored.value) as AppliedFx) : null; } catch { applied = null; }
  const save = (rates: Record<string, number>) =>
    run("INSERT INTO meta(key, value) VALUES ('derived_fx_rates', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify({ version: LANDED_VERSION, rates } satisfies AppliedFx)]);
  if (!applied) {
    const legacy = await one<{ value: string }>("SELECT value FROM meta WHERE key = 'derived_fx_as_of'");
    if (legacy?.value.endsWith(`|v${LANDED_VERSION}`)) { await save({ ...fx.rates }); return 0; }
  }
  const due = currenciesToRecompute(fx.rates, applied);
  if (due !== 'all' && !due.length) return 0;
  const n = await listingsRepo.recomputeDerived(undefined, due === 'all' ? undefined : due);
  await save(due === 'all' ? { ...fx.rates } : { ...applied!.rates, ...Object.fromEntries(due.map((c) => [c, fx.rates[c]])) });
  return n;
}

/**
 * Markennamen im Bestand vereinheitlichen (Dubletten wie "MERCEDES-BENZ"/"Mercedes"). Liest nur die
 * unterschiedlichen Marken (indexgestützt) und schreibt je abweichender Schreibweise ein UPDATE, das auch
 * die Suchspalte nachzieht. Liefert die Zahl der geänderten Inserate.
 */
export async function canonicalizeStoredMakes(): Promise<{ listings: number; makes: number }> {
  const rows = await query<{ make: string }>('SELECT DISTINCT make FROM listings');
  let listings = 0;
  let makes = 0;
  for (const { make } of rows) {
    const canon = canonicalMake(make);
    if (!canon || canon === make) continue;
    // ref_key leeren: der Bucket-Schlüssel enthält die Marke; der Vergleichspreis-Job trägt ihn neu ein
    const r = await run(`UPDATE listings SET make = ?, search_text = ${searchTextSql('?')}, ref_key = NULL WHERE make = ?`, [canon, canon, make]);
    listings += r.rowsAffected;
    makes++;
  }
  return { listings, makes };
}

export async function syncAll(): Promise<SyncReport[]> {
  const reports: SyncReport[] = [];
  for (const p of activeProviders()) reports.push(await syncProvider(p));
  const orphans = await deactivateOrphans();
  for (const [source, n] of Object.entries(orphans)) {
    if (n > 0) reports.push({ provider: source, status: 'ok', upserted: 0, deactivated: n, warnings: ['Quelle ohne aktiven Provider – Bestand deaktiviert'], durationMs: 0 });
  }
  // Beendete Auktionen (Copart & Co. ohne Vollabgleich) aus dem aktiven Bestand nehmen
  const ta = Date.now();
  const ended = await listingsRepo.deactivateEndedAuctions();
  if (ended > 0) reports.push({ provider: 'auctions', status: 'ok', upserted: 0, deactivated: ended, warnings: ['Auktionen mit abgelaufenem Termin deaktiviert'], durationMs: Date.now() - ta });
  const tm = Date.now();
  const canon = await canonicalizeStoredMakes();
  if (canon.listings > 0) reports.push({ provider: 'makes', status: 'ok', upserted: canon.listings, deactivated: 0, warnings: [`${canon.makes} Markenschreibweisen vereinheitlicht`], durationMs: Date.now() - tm });
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
