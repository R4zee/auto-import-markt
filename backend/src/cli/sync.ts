import { closeDb, ready } from '../db.js';
import { getFx } from '../services/fx.js';
import { syncAll } from '../services/sync.js';

await ready();
await getFx();
const reports = await syncAll();
for (const r of reports) {
  console.log(`${r.status === 'ok' ? '✔' : '✖'} ${r.provider.padEnd(12)} upserted=${r.upserted} deactivated=${r.deactivated} ${r.durationMs}ms ${r.error ?? ''}`);
}
await closeDb();
