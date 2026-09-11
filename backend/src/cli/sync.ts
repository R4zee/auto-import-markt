import { closeDb, ready } from '../db.ts';
import { getFx } from '../services/fx.ts';
import { syncAll } from '../services/sync.ts';

await ready();
await getFx();
const reports = await syncAll();
for (const r of reports) {
  console.log(`${r.status === 'ok' ? '✔' : '✖'} ${r.provider.padEnd(12)} upserted=${r.upserted} deactivated=${r.deactivated} ${r.durationMs}ms ${r.error ?? ''}`);
}
await closeDb();
