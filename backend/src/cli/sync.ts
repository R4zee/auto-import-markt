import { closeDb, ready } from '../db.js';
import { getFx } from '../services/fx.js';
import { syncAll } from '../services/sync.js';
import { listingsRepo } from '../repositories/listings.js';
import { config } from '../config.js';

const target = config.database.url.startsWith('file:') ? 'lokale Datei' : config.database.url === ':memory:' ? 'In-Memory' : config.database.url;
console.log(`Sync → ${target}`);
await ready();
await getFx();
const reports = await syncAll();
for (const r of reports) {
  const warn = r.warnings?.length ? `  ⚠ ${r.warnings.join(' | ')}` : '';
  console.log(`${r.status === 'ok' ? '✔' : '✖'} ${r.provider.padEnd(12)} upserted=${r.upserted} deactivated=${r.deactivated} ${r.durationMs}ms ${r.error ?? ''}${warn}`);
}
console.log('Bestand je Quelle:', JSON.stringify(await listingsRepo.countBySource()));
await closeDb();
