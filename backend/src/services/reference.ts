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

export const KM_BAND_STEP = 25000;
export const KM_BAND_MAX = 300000;

/**
 * Laufleistungsband für die Suche: die Obergrenze des km-Fensters, auf 25.000 km aufgerundet (mindestens 50.000),
 * damit mobile.de nur passende Angebote liefert und nicht die Seite mit 300.000-km-Wagen füllt. Über 300.000 km
 * ohne Grenze. Muss zur SQL-Gruppierung in refreshReferenceBuckets passen.
 */
export function kmBandFor(km: number): number | null {
  const pct = km < config.reference.kmThreshold ? config.reference.kmWindowBelow : config.reference.kmWindowAbove;
  // ganzzahlig wie in kmBandSql() (CAST … AS INTEGER schneidet ab)
  const to = Math.floor(km * (1 + pct));
  if (to > KM_BAND_MAX) return null;
  return Math.max(2 * KM_BAND_STEP, Math.ceil(to / KM_BAND_STEP) * KM_BAND_STEP);
}

/** Dasselbe Band als SQL-Ausdruck über die Spalte `km` (Gruppierung im Refresh-Job) – muss zu kmBandFor() passen */
export function kmBandSql(): string {
  const { kmThreshold, kmWindowBelow, kmWindowAbove } = config.reference;
  const kmTo = `CAST((CASE WHEN km < ${kmThreshold} THEN km * ${1 + kmWindowBelow} ELSE km * ${1 + kmWindowAbove} END) AS INTEGER)`;
  // Ganzzahldivision: (n + Schritt − 1) / Schritt = aufrunden
  return `CASE WHEN ${kmTo} > ${KM_BAND_MAX} THEN NULL ELSE MAX(${2 * KM_BAND_STEP}, ((${kmTo} + ${KM_BAND_STEP - 1}) / ${KM_BAND_STEP}) * ${KM_BAND_STEP}) END`;
}

/**
 * Bucket-Abfrage: Marke, Variantentext, Kraftstoff, Baujahrband und Laufleistungsband. Das Baujahrband ist der
 * Bauzeitraum der Baureihe (W221, E93, F30 …), wenn das Inserat den Code nennt, sonst Baujahr ± REFERENCE_YEAR_SPAN.
 * `kmBand` übersteuert das aus `km` berechnete Band (Refresh-Job gruppiert in SQL).
 */
export function bucketQuery(l: Pick<Listing, 'make' | 'model' | 'trim' | 'year' | 'fuel' | 'km'> & { kmBand?: number | null }): RefQuery | null {
  if (mobileMakeId(l.make) == null) return null;
  const description = variantText(l);
  if (!description) return null;
  const band = yearBand(l, config.reference.yearSpan);
  const kmTo = l.kmBand !== undefined ? l.kmBand : kmBandFor(l.km);
  const model = l.model.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return { make: l.make, description, yearFrom: band.from, yearTo: band.to, fuel: (l.fuel as Fuel) ?? null, generation: band.generation, kmTo, model };
}

// --- Modell-IDs von mobile.de (SEO-Modellseite → filters.ms[0].model), Cache in `meta` ------------------------------

const MODEL_TTL_MS = 30 * 86400000;
const modelMemo = new Map<string, number | null>();

/**
 * mobile.de-Modell-ID für Marke + Modellname (z. B. "S-Class" → S-Klasse). Ergebnis (auch „unbekannt“) liegt 30 Tage
 * in `meta`, damit je Modell nur eine Anfrage anfällt. Baureihen-Codes im Modellnamen ("S-Class W221") werden entfernt.
 */
export async function modelIdFor(make: string, model: string): Promise<number | null> {
  const clean = model.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\b[A-Z]{1,2}\d{2,3}\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const key = `mobile_model|${makeKey(make)}|${clean.toLowerCase()}`;
  if (modelMemo.has(key)) return modelMemo.get(key) ?? null;
  const row = await one<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
  if (row) {
    try {
      const v = JSON.parse(row.value) as { modelId: number | null; at: string };
      if (Date.now() - new Date(v.at).getTime() < MODEL_TTL_MS) { modelMemo.set(key, v.modelId); return v.modelId; }
    } catch { /* neu auflösen */ }
  }
  let modelId: number | null = null;
  try {
    const r = await source.resolveModel(make, clean);
    // Nur übernehmen, wenn mobile.de auch die Marke erkannt hat (sonst war es eine generische Seite)
    modelId = r.makeId != null && r.modelId != null ? r.modelId : null;
  } catch (e) {
    if (e instanceof HttpError && (e.status === 403 || e.status === 429)) throw e;
    modelId = null;
  }
  await run("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, JSON.stringify({ modelId, at: new Date().toISOString() })]);
  modelMemo.set(key, modelId);
  return modelId;
}

export function bucketKey(q: RefQuery): string {
  return `${source.id}|${makeKey(q.make)}|${q.description.toLowerCase()}|${q.fuel ?? 'any'}|${q.yearFrom}-${q.yearTo}|km${q.kmTo ?? 'all'}`;
}

/**
 * Gleiche Motorisierung: Hubraum innerhalb der Toleranz, sofern beide Seiten einen kennen; zusätzlich Leistung ±15 %,
 * sofern beide sie kennen (wichtig für Inserate ohne Baureihen-Code). Fehlende Werte schließen nicht aus.
 */
export function engineMatches(l: Pick<Listing, 'engineCcm' | 'powerKw'>, s: RefSample): boolean {
  if (l.engineCcm != null && s.ccm != null && Math.abs(s.ccm - l.engineCcm) > l.engineCcm * config.reference.ccmTolerance) return false;
  const kw = l.powerKw ?? null;
  if (kw != null && s.kw != null && Math.abs(s.kw - kw) > Math.max(8, kw * config.reference.kwTolerance)) return false;
  return true;
}

/**
 * Modellabgleich über den Titel: mobile.de sucht die Beschreibung unscharf ("S350" trifft auch CLS 350, E 350, GLK 350).
 * Die Variantenkennung muss deshalb als eigenes Wort im mobile.de-Modellnamen oder Titel stehen – Buchstaben- und
 * Zifferngruppen dürfen durch Leerzeichen/Bindestrich getrennt sein ("S 350", "S350", "320 d", "320d"); ein
 * angehängter Einzelbuchstabe (d/i) ist optional, damit "E 220 d" auch "E 220 CDI" findet.
 */
export function titleMatches(description: string, s: Pick<RefSample, 'title' | 'model'>): boolean {
  const groups = description.match(/\p{L}+|\p{N}+/gu) ?? [];
  if (!groups.length) return true;
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = groups.map((g, i) => (i === groups.length - 1 && groups.length > 1 && /^\p{L}$/u.test(g) ? `(?:[\\s-]?${esc(g)})?` : (i ? '[\\s-]?' : '') + esc(g))).join('');
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'iu');
  return re.test(s.model ?? '') || re.test(s.title);
}

export function comparable(l: Pick<Listing, 'km' | 'engineCcm' | 'powerKw'>, b: RefBucket): { samples: RefSample[]; kmFrom: number; kmTo: number } {
  const { from, to } = kmWindow(l.km);
  const samples = b.samples
    .filter((s) => s.km >= from && s.km <= to && engineMatches(l, s) && titleMatches(b.query.description, s))
    .sort((a, c) => a.priceEur - c.priceEur);
  return { samples, kmFrom: from, kmTo: to };
}

export function diffPct(landedEur: number, refEur: number): number {
  return Math.round(((landedEur - refEur) / refEur) * 1000) / 10;
}

export function summarize(l: Pick<Listing, 'km' | 'engineCcm' | 'powerKw'>, landedEur: number, b: RefBucket): ReferenceSummary | null {
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

export function detailFrom(l: Pick<Listing, 'km' | 'engineCcm' | 'powerKw'>, landedEur: number, b: RefBucket): ReferencePrices {
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

/**
 * Bucket live holen und speichern (Refresh-Job und Detailansicht). Mit bekannter Modell-ID sucht mobile.de nur dieses
 * Modell (ms=<make>;<model>;;), sonst per Beschreibung; Treffer anderer Modelle (unscharfe Suche) fliegen gleich raus.
 */
export async function fetchBucket(q: RefQuery): Promise<RefBucket> {
  const modelId = q.modelId !== undefined ? q.modelId : q.model ? await modelIdFor(q.make, q.model) : null;
  const query: RefQuery = { ...q, modelId };
  const r = await source.fetchSamples(query);
  const matching = r.samples.filter((s) => titleMatches(q.description, s));
  const b: RefBucket = { key: bucketKey(q), source: source.id, query, samples: matching.slice(0, 80), total: r.total, url: r.url, fetchedAt: new Date().toISOString() };
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
  const rows = await query<{ make: string; model: string; trim1: string; fuel: string; year: number; km_band: number | null; n: number }>(
    `SELECT make, model, substr(trim, 1, instr(trim || ' ', ' ') - 1) AS trim1, fuel, year, ${kmBandSql()} AS km_band, COUNT(*) AS n
     FROM listings WHERE active = 1 GROUP BY make, model, trim1, fuel, year, km_band`,
  );
  const wanted = new Map<string, { q: RefQuery; n: number }>();
  for (const r of rows) {
    const q = bucketQuery({ make: r.make, model: r.model, trim: r.trim1 ?? '', year: Number(r.year), fuel: r.fuel as Fuel, km: 0, kmBand: r.km_band == null ? null : Number(r.km_band) });
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
      log(`  ✔ ${q.make} ${q.description} ${q.fuel ?? ''} ${q.yearFrom}–${q.yearTo}${q.kmTo ? ` ≤${q.kmTo} km` : ''}${b.query.modelId ? ` [Modell ${b.query.modelId}]` : ''} (${n} Inserate) → ${b.samples.length} passende${b.total != null ? ` von ${b.total}` : ''}, ab ${b.samples[0]?.priceEur ?? '–'} €`);
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
