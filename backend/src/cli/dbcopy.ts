import { createClient } from '@libsql/client';
import { copyDatabase } from '../services/dbcopy.js';

/**
 * Datenbank kopieren (Teil M): SOURCE_DATABASE_URL/SOURCE_AUTH_TOKEN → TARGET_DATABASE_URL/TARGET_AUTH_TOKEN.
 * Aufruf: npm run db:copy [-- --only listings,meta] [--batch 500] [--pause 50]
 * Läuft auch als Workflow „DB Copy“ auf dem GitHub-Runner (Quelle = TURSO_*, Ziel = NEW_* Secrets).
 */
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const need = (name: string): string => {
  const v = process.env[name];
  if (!v) { console.error(`${name} fehlt`); process.exit(2); }
  return v;
};

const srcUrl = need('SOURCE_DATABASE_URL');
const dstUrl = need('TARGET_DATABASE_URL');
if (srcUrl === dstUrl) { console.error('Quelle und Ziel sind dieselbe Datenbank'); process.exit(2); }
const src = createClient({ url: srcUrl, authToken: process.env.SOURCE_AUTH_TOKEN });
const dst = createClient({ url: dstUrl, authToken: process.env.TARGET_AUTH_TOKEN });

const only = arg('only')?.split(',').map((s) => s.trim()).filter(Boolean);
const started = Date.now();
console.log(`DB-Kopie ${srcUrl.replace(/\?.*$/, '')} → ${dstUrl.replace(/\?.*$/, '')}${only ? ` · nur ${only.join(', ')}` : ''}`);
const report = await copyDatabase(src, dst, {
  only,
  batch: Number(arg('batch') ?? 500),
  pauseMs: Number(arg('pause') ?? 0),
  log: (l) => console.log(`${l} · ${Math.round((Date.now() - started) / 1000)} s`),
});
console.log(`fertig: ${Object.values(report.tables).reduce((a, b) => a + b, 0)} Zeilen in ${Object.keys(report.tables).length} Tabellen, ${report.indexes} Indizes · ${Math.round((Date.now() - started) / 60000)} min`);
src.close();
dst.close();
