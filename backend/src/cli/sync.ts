import { closeDb, ready } from '../db.js';
import { getFx } from '../services/fx.js';
import { canonicalizeStoredMakes, syncAll, syncProvider, type SyncReport } from '../services/sync.js';
import { refreshFacets } from '../services/facets.js';
import { listingsRepo } from '../repositories/listings.js';
import { activeProviders } from '../providers/index.js';
import { config } from '../config.js';

const target = config.database.url.startsWith('file:') ? 'lokale Datei' : config.database.url === ':memory:' ? 'In-Memory' : 'Turso (remote)';
console.log(`Sync → ${target}`);
if (config.encar.enabled) {
  let proxyInfo = 'KEIN Proxy (Direktverbindung – aus Rechenzentren blockiert Encar!)';
  if (config.encar.proxyUrl) {
    try { const u = new URL(config.encar.proxyUrl); proxyInfo = `Proxy ${u.hostname}:${u.port || '80'} (Login ${u.username ? u.username.slice(0, 4) + '…' : 'ohne'})`; }
    catch { proxyInfo = 'Proxy-URL UNGÜLTIG (Form: http://user:pass@host:port)'; }
  }
  console.log(`Encar: ${proxyInfo} · Typen ${config.encar.carTypes.join(',')} · ab ${config.encar.minPriceManwon}만원 · ab ${config.encar.minYear}${config.encar.limitPartition ? ` · Test: max ${config.encar.limitPartition} je Teilabfrage` : ''}`);
}
await ready();
await getFx();
// SYNC_ONLY=olx,subito – nur diese (aktiven) Provider, ohne Bereinigung; leer = alles
const only = (process.env.SYNC_ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean);
let reports: SyncReport[];
if (only.length) {
  const chosen = activeProviders().filter((p) => only.includes(p.id));
  const missing = only.filter((id) => !chosen.some((p) => p.id === id));
  if (missing.length) console.log(`Nicht aktiv oder unbekannt: ${missing.join(', ')} (aktiv: ${activeProviders().map((p) => p.id).join(', ') || '–'})`);
  reports = [];
  for (const p of chosen) reports.push(await syncProvider(p));
  // Markenschreibweisen im Bestand vereinheitlichen (billig: nur DISTINCT-Marken), dann Filterlisten neu aufbauen
  const canon = await canonicalizeStoredMakes();
  if (canon.listings > 0) reports.push({ provider: 'makes', status: 'ok', upserted: canon.listings, deactivated: 0, warnings: [`${canon.makes} Markenschreibweisen vereinheitlicht`], durationMs: 0 });
  await refreshFacets();
} else {
  reports = await syncAll();
}
for (const r of reports) {
  const warn = r.warnings?.length ? `  ⚠ ${r.warnings.join(' | ')}` : '';
  console.log(`${r.status === 'ok' ? '✔' : '✖'} ${r.provider.padEnd(12)} upserted=${r.upserted} deactivated=${r.deactivated} ${r.durationMs}ms ${r.error ?? ''}${warn}`);
}
console.log('Bestand je Quelle:', JSON.stringify(await listingsRepo.countBySource()));
await closeDb();
// Fehlgeschlagene Provider lassen den Job rot werden (GitHub Actions), damit Probleme auffallen
if (reports.some((r) => r.status === 'error')) process.exitCode = 1;
