import type { InStatement } from '@libsql/client';
import { config, isServerless } from '../config.js';
import { db, one, query, run, type Row } from '../db.js';
import { yearBand } from '../domain/generations.js';
import { makeKey } from '../domain/makes.js';
import { DEST_CODES } from '../domain/markets.js';
import type { DecoratedListing, DestCode, Fuel, Listing, ReferenceSummary } from '../domain/types.js';
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
  const special = specialVariant(l.make, `${l.model} ${l.trim}`);
  if (special && !new RegExp(`(^|\\s)${special.token}(\\s|$)`, 'i').test(text)) text = `${text} ${special.token}`;
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Sondermodelle bei Exoten: mobile.de führt z. B. nur „Aventador“ als Modell, SV/SVJ/Performante stehen im Freitext.
 * Ein 2016er Aventador Superveloce wurde sonst mit jedem Aventador ab 350.000 € verglichen (Superveloce ab 530.000 €).
 * Liefert die Kennung in der gebräuchlichen Schreibweise (Superveloce → SV), damit Suche und Titelabgleich sie finden.
 */
const SPECIAL_VARIANTS: Array<[makes: string[], pattern: RegExp, token: string]> = [
  [['lamborghini'], /\bsvj\b/i, 'SVJ'], [['lamborghini'], /\bsv\b|\bsuperveloce\b/i, 'SV'], [['lamborghini'], /\bperformante\b/i, 'Performante'],
  [['lamborghini'], /\bsto\b/i, 'STO'], [['lamborghini'], /\btecnica\b/i, 'Tecnica'], [['lamborghini'], /\bultimae\b/i, 'Ultimae'],
  [['ferrari'], /\bpista\b/i, 'Pista'], [['ferrari'], /\bspeciale\b/i, 'Speciale'], [['ferrari'], /\bscuderia\b/i, 'Scuderia'],
  [['ferrari', 'maserati'], /\bcompetizione\b/i, 'Competizione'], [['ferrari'], /\btributo\b/i, 'Tributo'], [['ferrari'], /\bgts\b/i, 'GTS'],
  [['porsche'], /\bgt3 ?rs\b/i, 'GT3 RS'], [['porsche'], /\bgt2 ?rs\b/i, 'GT2 RS'], [['porsche'], /\bgt3\b/i, 'GT3'], [['porsche'], /\bgt2\b/i, 'GT2'],
  [['porsche'], /\bturbo s\b/i, 'Turbo S'], [['porsche'], /\bturbo\b/i, 'Turbo'], [['porsche'], /\bgts\b/i, 'GTS'], [['porsche'], /\btarga\b/i, 'Targa'],
  [['mclaren'], /\b(765lt|675lt|600lt|765 lt|675 lt|600 lt)\b/i, 'LT'], [['mclaren'], /\bsenna\b/i, 'Senna'],
  [['mercedesbenz', 'mercedesamg'], /\bblack series\b/i, 'Black Series'], [['maserati'], /\btrofeo\b/i, 'Trofeo'],
  // Karosserievariante zuletzt: Leistungsvarianten (Pista Spider → Pista) haben Vorrang
  [['lamborghini', 'ferrari', 'mclaren', 'porsche', 'astonmartin', 'maserati', 'bentley'], /\b(spyder|spider|roadster|volante)\b/i, 'Spyder'],
];

export function specialVariant(make: string, text: string): { token: string; pattern: RegExp } | null {
  const key = makeKey(make);
  for (const [makes, pattern, token] of SPECIAL_VARIANTS) {
    if (makes.includes(key) && pattern.test(text)) return { token, pattern };
  }
  return null;
}

/** Endet die Beschreibung auf eine Sondermodell-Kennung, Basis und Kennung trennen ("Aventador SV" → "Aventador" + SV) */
function splitSpecial(description: string): { base: string; special: { token: string; pattern: RegExp } | null } {
  for (const [, pattern, token] of SPECIAL_VARIANTS) {
    const re = new RegExp(`\\s${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    if (re.test(description)) return { base: description.replace(re, '').trim(), special: { token, pattern } };
  }
  return { base: description, special: null };
}

/**
 * Laufleistungsfenster: nur nach oben begrenzt (+50 % unter 100.000 km, +30 % darüber), nach unten offen. Fahrzeuge mit
 * sehr wenig Laufleistung werden mit allen bis REFERENCE_KM_FLOOR (20.000 km) verglichen – ein 1.600-km-Aventador fand
 * sonst nur Angebote bis 2.400 km.
 */
export function kmWindow(km: number): { from: number; to: number } {
  const pct = km < config.reference.kmThreshold ? config.reference.kmWindowBelow : config.reference.kmWindowAbove;
  return { from: 0, to: Math.max(config.reference.kmFloor, Math.round(km * (1 + pct))) };
}

/**
 * Leistungsbänder (kW) für die Suche: mobile.de sortiert nach Preis, ohne Leistungsfilter liefern die ersten Seiten
 * nur die schwächsten Motoren eines Modells (X6 M 460 kW fand unter 40 günstigen X6 40i genau ein Angebot).
 */
export const KW_BANDS = [0, 60, 80, 100, 120, 145, 175, 210, 250, 300, 360, 430, 520, 650];

export function kwBandFor(kw: number | null | undefined): { from: number; to: number | null } | null {
  if (kw == null || !(kw > 0)) return null;
  let i = 0;
  while (i + 1 < KW_BANDS.length && kw >= KW_BANDS[i + 1]) i++;
  return { from: KW_BANDS[i], to: i + 1 < KW_BANDS.length ? KW_BANDS[i + 1] : null };
}

/** Suchfenster zum Band mit 15 % Rand, damit Nachbarn am Bandrand (Leistungs-Toleranz in engineMatches) nicht fehlen */
export function kwWindow(kw: number): { from: number; to: number | null } {
  const b = kwBandFor(kw) ?? { from: 0, to: null };
  return { from: Math.floor(b.from * 0.85), to: b.to == null ? null : Math.ceil(b.to * 1.15) };
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
export interface ModelRef { modelId: number | null; modelGroupId: number | null; makeId?: number | null }
const NO_MODEL: ModelRef = { modelId: null, modelGroupId: null };
const modelMemo = new Map<string, ModelRef>();

/**
 * mobile.de-Modell- bzw. Modellgruppen-ID für Marke + Modellname (z. B. "S-Class" → Gruppe S-Klasse = 16). Ergebnis
 * (auch „unbekannt“) liegt 30 Tage in `meta`, damit je Modell nur eine Anfrage anfällt. Baureihen-Codes im
 * Modellnamen ("S-Class W221") werden entfernt.
 */
export async function modelRefFor(make: string, model: string): Promise<ModelRef> {
  const clean = model.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\b[A-Z]{1,2}\d{2,3}\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return NO_MODEL;
  const key = `mobile_model|${makeKey(make)}|${clean.toLowerCase()}`;
  const memo = modelMemo.get(key);
  if (memo) return memo;
  const row = await one<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
  if (row) {
    try {
      const v = JSON.parse(row.value) as { modelId?: number | null; modelGroupId?: number | null; makeId?: number | null; at: string };
      if (Date.now() - new Date(v.at).getTime() < MODEL_TTL_MS) {
        const ref: ModelRef = { modelId: v.modelId ?? null, modelGroupId: v.modelGroupId ?? null, makeId: v.makeId ?? null };
        modelMemo.set(key, ref);
        return ref;
      }
    } catch { /* neu auflösen */ }
  }
  let ref: ModelRef = NO_MODEL;
  try {
    const r = await source.resolveModel(make, clean);
    // Nur übernehmen, wenn mobile.de auch die Marke erkannt hat (sonst war es eine generische Seite). Die Marken-ID
    // der Antwort geht mit – sie ist verlässlicher als die hinterlegte Tabelle (Lauf 24: Land Rover/MINI mit 0 Treffern)
    if (r.makeId != null && (r.modelId != null || r.modelGroupId != null)) ref = { modelId: r.modelId, modelGroupId: r.modelGroupId, makeId: r.makeId };
    else if (r.makeId != null) ref = { modelId: null, modelGroupId: null, makeId: r.makeId };
  } catch (e) {
    if (e instanceof HttpError && (e.status === 403 || e.status === 429)) throw e;
  }
  await run("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, JSON.stringify({ ...ref, at: new Date().toISOString() })]);
  modelMemo.set(key, ref);
  return ref;
}

export function bucketKey(q: RefQuery): string {
  return `${source.id}|${makeKey(q.make)}|${q.description.toLowerCase()}|${q.fuel ?? 'any'}|${q.yearFrom}-${q.yearTo}|km${q.kmTo ?? 'all'}`;
}

/** Bucket-Schlüssel eines Inserats für die Spalte `listings.ref_key` ('' = für diese Marke/Variante kein Bucket möglich) */
export function refKeyFor(l: Pick<Listing, 'make' | 'model' | 'trim' | 'year' | 'fuel' | 'km'>): string {
  const q = bucketQuery(l);
  return q ? bucketKey(q) : '';
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
  // Sondermodell-Kennung ("Aventador SV") getrennt prüfen: die Basis muss zusammenhängend vorkommen, die Kennung
  // irgendwo im Titel in einer ihrer Schreibweisen (SV/Superveloce, Spyder/Roadster …)
  const { base, special } = splitSpecial(description);
  const groups = base.match(/\p{L}+|\p{N}+/gu) ?? [];
  if (special && !special.pattern.test(`${s.model ?? ''} ${s.title}`)) return false;
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
  const ref: ModelRef = q.modelId !== undefined || q.modelGroupId !== undefined
    ? { modelId: q.modelId ?? null, modelGroupId: q.modelGroupId ?? null }
    : q.model ? await modelRefFor(q.make, q.model) : NO_MODEL;
  const query: RefQuery = { ...q, ...ref };
  const r = await source.fetchSamples(query);
  const matching = r.samples.filter((s) => titleMatches(q.description, s));
  const b: RefBucket = { key: bucketKey(q), source: source.id, query, samples: matching.slice(0, 80), total: r.total, url: r.url, fetchedAt: new Date().toISOString() };
  await referenceRepo.save(b);
  // Inserate dieses Buckets fortschreiben (Sortierspalten). Nicht in der Function: dort fehlt ggf. noch der Index auf ref_key
  if (!isServerless) await applyBucketToListings(b);
  return b;
}

// --- Vergleichspreis-Spalten je Inserat (ref_min_eur, ref_diff_<Zielland>) -----------------------------------------

interface RefListingRow extends Row {
  id: string; km: number; engine_ccm: number | null; power_kw: number | null;
  landed_de: number | null; landed_at: number | null; landed_nl: number | null; landed_pl: number | null;
}
const REF_LISTING_COLS = 'id, km, engine_ccm, power_kw, landed_de, landed_at, landed_nl, landed_pl';

/**
 * UPDATE-Anweisungen: günstigstes vergleichbares Angebot und Abstand je Zielland für die Inserate eines Buckets.
 * ref_min_eur = 0 heißt „geprüft, kein vergleichbares Angebot“ (Abstände NULL) – NULL heißt „noch nicht berechnet“.
 */
function referenceUpdates(rows: RefListingRow[], b: RefBucket): InStatement[] {
  return rows.map((r) => {
    const l = { km: Number(r.km), engineCcm: r.engine_ccm == null ? null : Number(r.engine_ccm), powerKw: r.power_kw == null ? null : Number(r.power_kw) };
    const min = comparable(l, b).samples[0]?.priceEur ?? 0;
    const diff = (dest: DestCode): number | null => {
      const landed = r[`landed_${dest.toLowerCase()}` as keyof RefListingRow];
      return min > 0 && landed != null ? diffPct(Number(landed), min) : null;
    };
    return { sql: 'UPDATE listings SET ref_min_eur = ?, ref_diff_de = ?, ref_diff_at = ?, ref_diff_nl = ?, ref_diff_pl = ? WHERE id = ?', args: [min, ...DEST_CODES.map(diff), r.id] };
  });
}

async function writeBatches(stmts: InStatement[]): Promise<void> {
  for (let i = 0; i < stmts.length; i += 300) await db().batch(stmts.slice(i, i + 300), 'write');
}

/**
 * Nach dem Laden eines Buckets: Vergleichspreis-Spalten aller aktiven Inserate mit diesem ref_key neu setzen.
 * `+active`: der Planer soll den Index auf ref_key nehmen, nicht einen (active, …)-Index über den ganzen Bestand
 * (Lauf 28: rund 10 s je Bucket statt 3 s).
 */
export async function applyBucketToListings(b: RefBucket): Promise<number> {
  const rows = await query<RefListingRow>(`SELECT ${REF_LISTING_COLS} FROM listings WHERE ref_key = ? AND +active = 1`, [b.key]);
  if (rows.length) await writeBatches(referenceUpdates(rows, b));
  return rows.length;
}

export interface BackfillReport { keyed: number; pending: number; updated: number; buckets: number; stopped: string | null }

/**
 * Sortierspalten nachziehen: (1) Inserate ohne Bucket-Schlüssel (Bestand von vor der Spalte, Markenvereinheitlichung)
 * bekommen ihren Schlüssel; (2) Inserate mit Schlüssel, deren Vergleichspreis noch nie berechnet wurde (ref_min_eur NULL),
 * werden mit bereits vorhandenen Buckets versorgt – Buckets, die noch fehlen, folgen beim Nachladen. Läuft im
 * Vergleichspreis-Job vor dem Nachladen; blockweise, mit Zeitbudget, der Rest folgt im nächsten Lauf.
 */
export async function backfillReferenceColumns(opts: { maxMs?: number; log?: (line: string) => void } = {}): Promise<BackfillReport> {
  const started = Date.now();
  const maxMs = opts.maxMs ?? 20 * 60000;
  const log = opts.log ?? (() => undefined);
  const report: BackfillReport = { keyed: 0, pending: 0, updated: 0, buckets: 0, stopped: null };
  for (;;) {
    if (Date.now() - started > maxMs) { report.stopped = `Zeitbudget von ${Math.round(maxMs / 60000)} min erreicht`; return report; }
    const rows = await query<{ id: string; make: string; model: string; trim: string; year: number; fuel: string; km: number }>(
      'SELECT id, make, model, trim, year, fuel, km FROM listings WHERE ref_key IS NULL AND active = 1 LIMIT 5000',
    );
    if (!rows.length) break;
    await writeBatches(rows.map((r) => ({
      sql: 'UPDATE listings SET ref_key = ? WHERE id = ?',
      args: [refKeyFor({ make: r.make, model: r.model, trim: r.trim, year: Number(r.year), fuel: r.fuel as Fuel, km: Number(r.km) }), r.id],
    })));
    report.keyed += rows.length;
    if (report.keyed % 25000 < 5000) log(`  … ${report.keyed} Inserate mit Bucket-Schlüssel · ${Math.round((Date.now() - started) / 60000)} min`);
  }
  // Offene Inserate (Teilindex idx_listings_ref_pending: ref_min_eur IS NULL AND active = 1) nach Bucket gruppieren
  const pending = await query<RefListingRow & { ref_key: string }>(`SELECT ${REF_LISTING_COLS}, ref_key FROM listings WHERE ref_min_eur IS NULL AND active = 1 AND ref_key <> ''`);
  report.pending = pending.length;
  const byKey = new Map<string, RefListingRow[]>();
  for (const r of pending) { const list = byKey.get(r.ref_key); if (list) list.push(r); else byKey.set(r.ref_key, [r]); }
  if (!byKey.size) return report;
  const existing = await referenceRepo.fetchedAt();
  const keys = [...byKey.keys()].filter((k) => existing.has(k));
  log(`  offen: ${pending.length} Inserate in ${byKey.size} Buckets, davon ${keys.length} Buckets bereits geladen`);
  for (let i = 0; i < keys.length; i += 100) {
    if (Date.now() - started > maxMs) { report.stopped = `Zeitbudget von ${Math.round(maxMs / 60000)} min erreicht (${keys.length - i} Buckets offen)`; break; }
    const buckets = await referenceRepo.byKeys(keys.slice(i, i + 100));
    const stmts: InStatement[] = [];
    for (const [key, b] of buckets) { stmts.push(...referenceUpdates(byKey.get(key) ?? [], b)); report.buckets++; }
    await writeBatches(stmts);
    report.updated += stmts.length;
  }
  return report;
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

export interface RefreshReport {
  candidates: number; fetched: number; fresh: number; failed: number; samples: number;
  /** Buckets mit mindestens einem passenden Angebot */
  withSamples: number;
  /** Abbruch wegen Sperre/Fehlern (Job rot) */
  aborted: string | null;
  /** Regulär vor dem Limit beendet, z. B. Zeitbudget erreicht (Job grün) */
  stopped: string | null;
}

/**
 * Buckets aller aktiven Inserate bestimmen (Gruppierung in SQL nach Marke, Modell, erstem Ausstattungswort,
 * Kraftstoff, Baujahr), die häufigsten zuerst, fehlende oder abgelaufene bis `limit` nachladen.
 * Bricht bei Sperre (403/429) ab, damit der Job nicht in eine Blockade läuft.
 */
export async function refreshReferenceBuckets(opts: { limit?: number; maxMs?: number; log?: (line: string) => void } = {}): Promise<RefreshReport> {
  const limit = opts.limit ?? config.reference.maxPerRun;
  const maxMs = opts.maxMs ?? config.reference.maxMinutes * 60000;
  const started = Date.now();
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
  const report: RefreshReport = { candidates: wanted.size, fetched: 0, fresh: wanted.size - due.length, failed: 0, aborted: null, stopped: null, samples: 0, withSamples: 0 };
  const todo = due.slice(0, limit);
  const concurrency = Math.max(1, config.reference.concurrency);
  log(`Buckets: ${wanted.size} gesamt · ${report.fresh} aktuell · ${due.length} fällig · Limit ${limit} · Zeitbudget ${Math.round(maxMs / 60000)} min · ${concurrency} parallel`);
  // Mehrere Buckets parallel (REFERENCE_CONCURRENCY): jede mobile.de-Anfrage wartet ~1–2 s auf die Antwort
  let next = 0;
  const worker = async () => {
    while (next < todo.length && !report.aborted && !report.stopped) {
      // Zeitbudget: der nächste geplante Lauf soll nicht hinter diesem warten müssen
      if (Date.now() - started > maxMs) { report.stopped = `Zeitbudget von ${Math.round(maxMs / 60000)} min erreicht`; break; }
      const [, { q, n }] = todo[next++];
      try {
        const b = await fetchBucket(q);
        report.fetched++;
        report.samples += b.samples.length;
        if (b.samples.length) report.withSamples++;
        // Protokoll kompakt halten: Details nur für die ersten 20 Buckets, danach alle 100 eine Zwischensumme (REFERENCE_VERBOSE=true: alles)
        if (config.reference.verbose || report.fetched <= 20) {
          log(`  ✔ ${q.make} ${q.description} ${q.fuel ?? ''} ${q.yearFrom}–${q.yearTo}${q.kmTo ? ` ≤${q.kmTo} km` : ''}${b.query.modelId || b.query.modelGroupId ? ` [Modell ${b.query.modelId ?? `Gruppe ${b.query.modelGroupId}`}]` : ''} (${n} Inserate) → ${b.samples.length} passende${b.total != null ? ` von ${b.total}` : ''}, ab ${b.samples[0]?.priceEur ?? '–'} €`);
        } else if (report.fetched % 100 === 0) {
          log(`  … ${report.fetched} Buckets · ${report.withSamples} mit Angeboten · ${report.samples} Angebote · ${Math.round((Date.now() - started) / 60000)} min`);
        }
      } catch (e) {
        report.failed++;
        const msg = e instanceof Error ? e.message : String(e);
        log(`  ✖ ${q.make} ${q.description}: ${msg.slice(0, 120)}`);
        if (e instanceof HttpError && (e.status === 403 || e.status === 429)) { report.aborted = `HTTP ${e.status} – Lauf abgebrochen (Sperre)`; break; }
        if (report.failed >= 10 && report.fetched === 0) { report.aborted = 'zehn Fehler ohne Treffer – Lauf abgebrochen'; break; }
      }
      await sleep(config.reference.delayMs);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return report;
}
