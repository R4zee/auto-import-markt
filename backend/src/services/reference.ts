import { config } from '../config.js';
import { one, query, run, type Row } from '../db.js';
import { yearBand } from '../domain/generations.js';
import { makeKey } from '../domain/makes.js';
import type { DecoratedListing, Fuel, Listing, ReferenceSummary } from '../domain/types.js';
import { HttpError, sleep } from '../providers/http.js';
import { MobileDeReference, mobileMakeId, type RefQuery, type RefSample } from '../providers/mobilede.js';

/**
 * Vergleichspreise aus dem deutschen Markt.
 *
 * Ablauf: Je Suchbucket (Marke, Modell/Variante, Kraftstoff, Baujahr ±1) werden die günstigsten Angebote von
 * mobile.de mit Preis, Baujahr, km und Leistung in `ref_prices` abgelegt (Job cli/reference.ts, GitHub Actions).
 * Beim Ausliefern einer Trefferseite werden nur die Buckets der 48 Inserate gelesen (eine Abfrage) und je Inserat
 * das Laufleistungsfenster (höchstens +50 % unter 100.000 km, +30 % darüber; nach unten offen) sowie die
 * Motorisierung (Hubraum ±12 %) angewendet. Das Baujahrband folgt der Baureihe (W221, F30 …), sonst Baujahr ±1.
 * Ergebnis: günstigstes vergleichbares Angebot und Abstand des Endpreises inkl. TÜV in Prozent.
 */
export interface RefBucket {
  key: string;
  source: string;
  query: RefQuery;
  samples: RefSample[];
  total: number | null;
  url: string;
  fetchedAt: string;
}

/** Detailansicht: Zusammenfassung mit Median/Spanne (bestehende Karte) plus Fenster und Abstand */
export interface ReferencePrices {
  source: string;
  count: number;
  minEur: number | null;
  medianEur: number | null;
  maxEur: number | null;
  medianKm: number | null;
  yearFrom: number;
  yearTo: number;
  kmFrom: number;
  kmTo: number;
  landedEur: number;
  /** Endpreis relativ zum günstigsten vergleichbaren Angebot (Prozent) */
  diffPct: number | null;
  url: string | null;
  /** Baureihe, falls das Baujahrband daraus stammt (z. B. "W221") */
  generation: string | null;
  samples: Array<{ priceEur: number; year: number; km: number; url: string | null }>;
  fetchedAt: string;
}

const source = new MobileDeReference();

export function referenceEnabled(): boolean {
  return config.reference.enabled;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * Suchtext für mobile.de: Variantenkennung aus der Ausstattung (erstes Wort mit Ziffer, z. B. "320d", "E220d"),
 * sonst der Modellname ("Tucson", "Golf"). Mercedes schreibt mobile.de mit Leerzeichen ("E 220 d").
 */
export function variantText(l: Pick<Listing, 'make' | 'model' | 'trim'>): string {
  // Generationscodes in Klammern ("5 Series (G30)") weglassen
  const model = l.model.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const firstTrim = l.trim.trim().split(/[\s,·/|]+/)[0] ?? '';
  const classWord = /[- ]?\b(class|klasse|series|serie|reihe)\b/i;
  let text = model;
  if (classWord.test(model)) {
    // Baureihe ("3 Series", "E-Class"): Variantenkennung aus der Ausstattung ("320d", "E220d"), sonst der Buchstabe/die Zahl der Baureihe
    text = /\d/.test(firstTrim) && firstTrim.length >= 2 && firstTrim.length <= 12 ? firstTrim : model.replace(classWord, '').trim();
  }
  if (makeKey(l.make) === 'mercedesbenz') {
    // "E220d" → "E 220 d", "GLC300" → "GLC 300", "AMG GT" bleibt
    text = text.replace(/^([A-Za-z]{1,3})(\d{2,3})([a-z]?)$/i, (_m, a: string, b: string, c: string) => `${a.toUpperCase()} ${b}${c ? ` ${c.toLowerCase()}` : ''}`);
  }
  return text.replace(/\s+/g, ' ').trim();
}

/** Laufleistungsfenster: nur nach oben begrenzt (+50 % unter 100.000 km, +30 % darüber), nach unten offen */
export function kmWindow(km: number): { from: number; to: number } {
  const pct = km < config.reference.kmThreshold ? config.reference.kmWindowBelow : config.reference.kmWindowAbove;
  return { from: 0, to: Math.round(km * (1 + pct)) };
}

/**
 * Bucket-Abfrage: Marke, Variantentext, Kraftstoff und Baujahrband. Das Band ist der Bauzeitraum der Baureihe
 * (W221, E93, F30 …), wenn das Inserat den Code nennt, sonst Baujahr ± REFERENCE_YEAR_SPAN.
 */
export function bucketQuery(l: Pick<Listing, 'make' | 'model' | 'trim' | 'year' | 'fuel'>): RefQuery | null {
  if (mobileMakeId(l.make) == null) return null;
  const description = variantText(l);
  if (!description) return null;
  const band = yearBand(l, config.reference.yearSpan);
  return { make: l.make, description, yearFrom: band.from, yearTo: band.to, fuel: (l.fuel as Fuel) ?? null, generation: band.generation };
}

export function bucketKey(q: RefQuery): string {
  return `${source.id}|${makeKey(q.make)}|${q.description.toLowerCase()}|${q.fuel ?? 'any'}|${q.yearFrom}-${q.yearTo}`;
}

/** Gleiche Motorisierung: Hubraum innerhalb der Toleranz, sofern beide Seiten einen kennen; sonst nicht ausschließen */
export function engineMatches(l: Pick<Listing, 'engineCcm'>, s: RefSample): boolean {
  if (l.engineCcm == null || s.ccm == null) return true;
  return Math.abs(s.ccm - l.engineCcm) <= l.engineCcm * config.reference.ccmTolerance;
}

export function comparable(l: Pick<Listing, 'km' | 'engineCcm'>, b: RefBucket): { samples: RefSample[]; kmFrom: number; kmTo: number } {
  const { from, to } = kmWindow(l.km);
  const samples = b.samples.filter((s) => s.km >= from && s.km <= to && engineMatches(l, s)).sort((a, c) => a.priceEur - c.priceEur);
  return { samples, kmFrom: from, kmTo: to };
}

export function diffPct(landedEur: number, refEur: number): number {
  return Math.round(((landedEur - refEur) / refEur) * 1000) / 10;
}

export function summarize(l: Pick<Listing, 'km' | 'engineCcm'>, landedEur: number, b: RefBucket): ReferenceSummary | null {
  const { samples, kmFrom, kmTo } = comparable(l, b);
  if (!samples.length) return null;
  const best = samples[0];
  return {
    source: b.source,
    minEur: best.priceEur,
    medianEur: median(samples.map((s) => s.priceEur)),
    count: samples.length,
    kmFrom, kmTo,
    yearFrom: b.query.yearFrom, yearTo: b.query.yearTo,
    url: best.url,
    diffPct: diffPct(landedEur, best.priceEur),
    generation: b.query.generation ?? null,
    fetchedAt: b.fetchedAt,
  };
}

export function detailFrom(l: Pick<Listing, 'km' | 'engineCcm'>, landedEur: number, b: RefBucket): ReferencePrices {
  const { samples, kmFrom, kmTo } = comparable(l, b);
  const prices = samples.map((s) => s.priceEur);
  const minEur = prices.length ? prices[0] : null;
  return {
    source: b.source,
    count: samples.length,
    minEur,
    medianEur: median(prices),
    maxEur: prices.length ? prices[prices.length - 1] : null,
    medianKm: median(samples.map((s) => s.km)),
    yearFrom: b.query.yearFrom, yearTo: b.query.yearTo,
    kmFrom, kmTo,
    landedEur,
    diffPct: minEur != null ? diffPct(landedEur, minEur) : null,
    url: samples[0]?.url ?? null,
    generation: b.query.generation ?? null,
    samples: samples.slice(0, 12).map((s) => ({ priceEur: s.priceEur, year: s.year, km: s.km, url: s.url })),
    fetchedAt: b.fetchedAt,
  };
}

// --- Speicher (ref_prices) ---------------------------------------------------------------------------------------

interface RefRow extends Row { key: string; source: string; query_json: string; samples_json: string; total: number | null; url: string; fetched_at: string }

function rowToBucket(r: RefRow): RefBucket {
  return { key: r.key, source: r.source, query: JSON.parse(r.query_json) as RefQuery, samples: JSON.parse(r.samples_json) as RefSample[], total: r.total == null ? null : Number(r.total), url: r.url, fetchedAt: r.fetched_at };
}

export const referenceRepo = {
  async byKeys(keys: string[]): Promise<Map<string, RefBucket>> {
    const out = new Map<string, RefBucket>();
    for (let i = 0; i < keys.length; i += 100) {
      const chunk = keys.slice(i, i + 100);
      const rows = await query<RefRow>(`SELECT * FROM ref_prices WHERE key IN (${chunk.map(() => '?').join(',')})`, chunk);
      for (const r of rows) out.set(r.key, rowToBucket(r));
    }
    return out;
  },
  async byKey(key: string): Promise<RefBucket | null> {
    const r = await one<RefRow>('SELECT * FROM ref_prices WHERE key = ?', [key]);
    return r ? rowToBucket(r) : null;
  },
  async save(b: RefBucket): Promise<void> {
    await run(
      `INSERT INTO ref_prices(key, source, query_json, samples_json, total, url, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET source = excluded.source, query_json = excluded.query_json, samples_json = excluded.samples_json, total = excluded.total, url = excluded.url, fetched_at = excluded.fetched_at`,
      [b.key, b.source, JSON.stringify(b.query), JSON.stringify(b.samples), b.total, b.url, b.fetchedAt],
    );
  },
  /** Nur Schlüssel + Zeitstempel aller Buckets (für die Frische-Prüfung im Refresh-Job) */
  async fetchedAt(): Promise<Map<string, string>> {
    const rows = await query<{ key: string; fetched_at: string }>('SELECT key, fetched_at FROM ref_prices');
    return new Map(rows.map((r) => [r.key, r.fetched_at]));
  },
  async count(): Promise<number> {
    const r = await one<{ n: number }>('SELECT COUNT(*) AS n FROM ref_prices');
    return Number(r?.n ?? 0);
  },
};

// --- Ausliefern ----------------------------------------------------------------------------------------------------

/** Vergleichspreise aus dem Cache an dekorierte Inserate hängen (eine Abfrage je Seite; ohne Funktion keine Abfrage). */
export async function attachReferences(items: DecoratedListing[]): Promise<void> {
  for (const it of items) it.reference = null;
  if (!referenceEnabled() || !items.length) return;
  const wanted = new Map<string, RefQuery>();
  const keyOf = new Map<string, string>();
  for (const it of items) {
    const q = bucketQuery(it);
    if (!q) continue;
    const key = bucketKey(q);
    wanted.set(key, q);
    keyOf.set(it.id, key);
  }
  if (!wanted.size) return;
  const buckets = await referenceRepo.byKeys([...wanted.keys()]);
  for (const it of items) {
    const key = keyOf.get(it.id);
    const b = key ? buckets.get(key) : undefined;
    if (b) it.reference = summarize(it, it.landed.totalEur, b);
  }
}

/** Bucket live holen und speichern (Refresh-Job und Detailansicht) */
export async function fetchBucket(q: RefQuery): Promise<RefBucket> {
  const r = await source.fetchSamples(q);
  const b: RefBucket = { key: bucketKey(q), source: source.id, query: q, samples: r.samples.slice(0, 80), total: r.total, url: r.url, fetchedAt: new Date().toISOString() };
  await referenceRepo.save(b);
  return b;
}

const memo = new Map<string, { at: number; value: ReferencePrices | null }>();
const MEMO_MS = 10 * 60 * 1000;

/** Detailansicht: Cache, sonst (wenn erlaubt) live nachladen */
export async function referencePrices(l: Listing, landedEur: number): Promise<ReferencePrices | null> {
  if (!referenceEnabled()) return null;
  const q = bucketQuery(l);
  if (!q) return null;
  const key = bucketKey(q);
  const hit = memo.get(`${key}|${l.id}|${landedEur}`);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.value;
  let b = await referenceRepo.byKey(key);
  if (!b && config.reference.liveLookup) {
    try { b = await fetchBucket(q); } catch { b = null; }
  }
  const value = b ? detailFrom(l, landedEur, b) : null;
  memo.set(`${key}|${l.id}|${landedEur}`, { at: Date.now(), value });
  return value;
}

// --- Refresh-Job ---------------------------------------------------------------------------------------------------

export interface RefreshReport { candidates: number; fetched: number; fresh: number; failed: number; aborted: string | null; samples: number }

/**
 * Buckets aller aktiven Inserate bestimmen (Gruppierung in SQL nach Marke, Modell, erstem Ausstattungswort,
 * Kraftstoff, Baujahr), die häufigsten zuerst, fehlende oder abgelaufene bis `limit` nachladen.
 * Bricht bei Sperre (403/429) ab, damit der Job nicht in eine Blockade läuft.
 */
export async function refreshReferenceBuckets(opts: { limit?: number; log?: (line: string) => void } = {}): Promise<RefreshReport> {
  const limit = opts.limit ?? config.reference.maxPerRun;
  const log = opts.log ?? (() => undefined);
  const rows = await query<{ make: string; model: string; trim1: string; fuel: string; year: number; n: number }>(
    `SELECT make, model, substr(trim, 1, instr(trim || ' ', ' ') - 1) AS trim1, fuel, year, COUNT(*) AS n
     FROM listings WHERE active = 1 GROUP BY make, model, trim1, fuel, year`,
  );
  const wanted = new Map<string, { q: RefQuery; n: number }>();
  for (const r of rows) {
    const q = bucketQuery({ make: r.make, model: r.model, trim: r.trim1 ?? '', year: Number(r.year), fuel: r.fuel as Fuel });
    if (!q) continue;
    const key = bucketKey(q);
    const cur = wanted.get(key);
    if (cur) cur.n += Number(r.n); else wanted.set(key, { q, n: Number(r.n) });
  }
  const existing = await referenceRepo.fetchedAt();
  const cutoff = Date.now() - config.reference.ttlDays * 86400000;
  const due = [...wanted.entries()]
    .filter(([key]) => { const at = existing.get(key); return !at || new Date(at).getTime() < cutoff; })
    .sort((a, b) => b[1].n - a[1].n);
  const report: RefreshReport = { candidates: wanted.size, fetched: 0, fresh: wanted.size - due.length, failed: 0, aborted: null, samples: 0 };
  log(`Buckets: ${wanted.size} gesamt · ${report.fresh} aktuell · ${due.length} fällig · Limit ${limit}`);
  for (const [key, { q, n }] of due.slice(0, limit)) {
    try {
      const b = await fetchBucket(q);
      report.fetched++;
      report.samples += b.samples.length;
      log(`  ✔ ${q.make} ${q.description} ${q.fuel ?? ''} ${q.yearFrom}–${q.yearTo} (${n} Inserate) → ${b.samples.length} Angebote${b.total != null ? ` von ${b.total}` : ''}, ab ${b.samples[0]?.priceEur ?? '–'} €`);
    } catch (e) {
      report.failed++;
      const msg = e instanceof Error ? e.message : String(e);
      log(`  ✖ ${q.make} ${q.description}: ${msg.slice(0, 120)}`);
      if (e instanceof HttpError && (e.status === 403 || e.status === 429)) { report.aborted = `HTTP ${e.status} – Lauf abgebrochen (Sperre)`; break; }
      if (report.failed >= 10 && report.fetched === 0) { report.aborted = 'zehn Fehler ohne Treffer – Lauf abgebrochen'; break; }
    }
    void key;
    await sleep(config.reference.delayMs);
  }
  return report;
}
