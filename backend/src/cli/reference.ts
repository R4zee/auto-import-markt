import { config } from '../config.js';
import { closeDb, ready } from '../db.js';
import { backfillReferenceColumns, referenceRepo, refreshReferenceBuckets } from '../services/reference.js';

/**
 * Vergleichspreise DE (mobile.de) für die Buckets aller aktiven Inserate nachladen – läuft per GitHub Actions
 * nach dem Sync (REFERENCE_ENABLED=true). Je Lauf höchstens REFERENCE_MAX_PER_RUN Buckets, die häufigsten zuerst;
 * bereits aktuelle Buckets (jünger als REFERENCE_TTL_DAYS) werden übersprungen.
 *
 *   npm run reference -w backend            (gegen die konfigurierte Datenbank)
 *   REFERENCE_MAX_PER_RUN=20 npm run reference -w backend   (Testlauf)
 */
const target = config.database.url.startsWith('file:') ? 'lokale Datei' : config.database.url === ':memory:' ? 'In-Memory' : 'Turso (remote)';
console.log(`Vergleichspreise → ${target} · mobile.de-Modus ${config.reference.mobileMode} · ${config.reference.pages} Seiten je Bucket · Pause ${config.reference.delayMs} ms${config.reference.proxyUrl ? ' · Proxy' : ''}`);
if (!config.reference.enabled) {
  console.log('REFERENCE_ENABLED ist nicht gesetzt – nichts zu tun.');
  process.exit(0);
}
await ready();
// Sortierspalten (ref_key, ref_min_eur, ref_diff_*) für Inserate ohne Schlüssel nachtragen – normalerweise nur die
// seit dem letzten Lauf neu hinzugekommenen; beim ersten Lauf der ganze Bestand (blockweise, Zeitbudget 25 min)
const tb = Date.now();
const bf = await backfillReferenceColumns({ maxMs: 25 * 60000, log: console.log });
if (bf.keyed || bf.updated) console.log(`✔ columns      ${bf.keyed} Inserate mit Bucket-Schlüssel · ${bf.updated} mit Vergleichspreis aus ${bf.buckets} Buckets · ${Date.now() - tb} ms${bf.stopped ? `  ⚠ ${bf.stopped}` : ''}`);
const before = await referenceRepo.count();
const t0 = Date.now();
const r = await refreshReferenceBuckets({ log: console.log });
const after = await referenceRepo.count();
console.log(`${r.aborted ? '✖' : '✔'} reference    buckets=${r.fetched} (${r.withSamples} mit Angeboten, ${r.samples} Angebote) · aktuell=${r.fresh} · fehlgeschlagen=${r.failed} · Kandidaten=${r.candidates} · gespeichert ${before}→${after} · ${Date.now() - t0} ms${r.aborted ? `  ⚠ ${r.aborted}` : ''}${r.stopped ? `  ⚠ ${r.stopped}` : ''}`);
await closeDb();
if (r.aborted) process.exitCode = 1;
