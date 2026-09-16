import { config } from '../config.js';
import { canonicalMake } from '../domain/makes.js';
import type { Listing } from '../domain/types.js';
import { defaultPartnerFor } from '../seed/partners.js';
import { encarDrive } from './encar.js';
import { HttpError, num, robustFetch, sleep, str } from './http.js';
import { listingId, normalizeFuel, normalizeTransmission, type MarketProvider, type ProviderResult } from './types.js';

/**
 * Dubizzle Motors (VAE) über den Algolia-Proxy der Website (aus dem Netzwerk-Tab, 16.09.2026):
 *
 *   POST https://algolia.dubizzle.com/1/indexes/*\/queries?x-algolia-agent=Algolia+for+JavaScript+(4.24.0);+Browser+(lite)
 *   Body {"requests":[{"indexName":"motors.com","query":"","params":"page=0&hitsPerPage=25&attributesToRetrieve=[…]
 *         &filters=(\"category_v2.slug_paths\":\"motors/used-cars\")"}]}
 *
 * Der Proxy setzt App-ID und Search-Key serverseitig – die Header `x-algolia-application-id`/`x-algolia-api-key`
 * schickt die Seite leer mit. Die Website fragt selbst mit hitsPerPage=1000 an; Algolia liefert je Filter höchstens
 * 1.000 Treffer (paginationLimitedTo), deshalb Preisfenster in AED, die bei > 1.000 Treffern halbiert werden.
 *
 * Treffer (Algolia-Hit): objectID, uuid, name{en}, price (AED), is_price_hidden, absolute_url{en}, photos, photos_count,
 * location_list, added (Unix-Sekunden), seller_type, details{ Make, Model, Trim/„Motors Trim“, Year, Kilometers,
 * „Fuel Type“, „Transmission Type“, „Regional Specs“, Horsepower („300 - 399 HP“), „No. of Cylinders“, „Steering Side“,
 * „Body Type“ … je als { en: { value, slug? }, ar: {…} } }. Feldnamen mit `npm run probe -- dubizzle` gegenprüfen.
 */
export interface DubizzleHit {
  objectID?: string; id?: number | string; uuid?: string;
  absolute_url?: unknown; permalink?: string; short_url?: string; name?: unknown; price?: number | string; is_price_hidden?: boolean;
  photos?: unknown; photo_thumbnails?: unknown; photos_count?: number | string; location_list?: unknown; added?: number | string; created_at?: number | string;
  seller_type?: string; details?: Record<string, unknown>; details_v2?: Record<string, unknown>; category_v2?: unknown; site?: unknown;
  is_reserved?: boolean; is_coming_soon?: boolean; has_vin?: boolean;
}
export interface DubizzleResult { hits?: DubizzleHit[]; nbHits?: number; page?: number; nbPages?: number; hitsPerPage?: number }
export interface DubizzleResponse { results?: DubizzleResult[]; message?: string }

export const DUBIZZLE_ENDPOINT = 'https://algolia.dubizzle.com/1/indexes/*/queries?x-algolia-agent=Algolia+for+JavaScript+(4.24.0)%3B+Browser+(lite)';
export const DUBIZZLE_INDEX = 'motors.com';
export const DUBIZZLE_CATEGORY = 'motors/used-cars';
/** Algolia gibt je Filter höchstens so viele Treffer heraus (paginationLimitedTo) */
export const ALGOLIA_HIT_LIMIT = 1000;
const ATTRIBUTES = ['objectID', 'id', 'uuid', 'absolute_url', 'permalink', 'short_url', 'name', 'price', 'is_price_hidden', 'photos', 'photo_thumbnails',
  'photos_count', 'location_list', 'added', 'created_at', 'details', 'details_v2', 'seller_type', 'is_reserved', 'is_coming_soon', 'has_vin'];

export type PriceBand = [number, number | null];

/** Algolia-`filters` für Kategorie und Preisfenster (AED, `to` exklusiv, null = offen) */
export function dubizzleFilters(band: PriceBand): string {
  const parts = [`("category_v2.slug_paths":"${DUBIZZLE_CATEGORY}")`];
  if (band[0] > 0) parts.push(`price >= ${band[0]}`);
  if (band[1] != null) parts.push(`price < ${band[1]}`);
  return parts.join(' AND ');
}

export function dubizzleParams(band: PriceBand, page: number, hitsPerPage: number): string {
  const p = new URLSearchParams({ page: String(page), hitsPerPage: String(hitsPerPage) });
  p.set('attributesToRetrieve', JSON.stringify(ATTRIBUTES));
  p.set('attributesToHighlight', '[]');
  p.set('filters', dubizzleFilters(band));
  return p.toString();
}

export function dubizzleBody(band: PriceBand, page: number, hitsPerPage: number): string {
  return JSON.stringify({ requests: [{ indexName: DUBIZZLE_INDEX, query: '', params: dubizzleParams(band, page, hitsPerPage) }] });
}

export function dubizzleHeaders(): Record<string, string> {
  return {
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    // Der Algolia-JS-Client schickt JSON mit diesem Content-Type; der Proxy erwartet ihn so
    'Content-Type': 'application/x-www-form-urlencoded',
    Origin: 'https://uae.dubizzle.com',
    Referer: 'https://uae.dubizzle.com/motors/used-cars/',
    'User-Agent': config.europe.userAgent,
    'x-algolia-api-key': '',
    'x-algolia-application-id': '',
  };
}

/** Anfängliche Preisfenster (AED): unten fein, oben grob – bei > 1.000 Treffern wird ein Fenster halbiert. */
export function initialBands(minPrice: number): PriceBand[] {
  const bands: PriceBand[] = [];
  let from = Math.max(0, minPrice);
  for (const step of [10_000, 10_000, 10_000, 15_000, 15_000, 20_000, 20_000, 30_000, 50_000, 100_000, 200_000, 500_000]) {
    bands.push([from, from + step]);
    from += step;
  }
  bands.push([from, null]);
  return bands;
}

/** Fenster halbieren; null, wenn es nicht weiter teilbar ist (Breite ≤ 100 AED) */
export function splitBand(band: PriceBand): [PriceBand, PriceBand] | null {
  const [from, to] = band;
  if (to == null) {
    const mid = Math.max(from + 50_000, Math.round(from * 1.5));
    return [[from, mid], [mid, null]];
  }
  if (to - from <= 100) return null;
  const mid = Math.floor((from + to) / 2);
  return [[from, mid], [mid, to]];
}

/** Textwert eines Dubizzle-Details: { en: { value } } | { en: 'x' } | { value } | 'x' */
export function detailText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v !== 'object') return '';
  const o = v as Record<string, unknown>;
  if (o.en != null) return detailText(o.en);
  if (o.value != null) return detailText(o.value);
  if (o.name != null) return detailText(o.name);
  if (Array.isArray(v)) return detailText(v[0]);
  return '';
}

/** Detail nach einem von mehreren Schlüsseln (Groß-/Kleinschreibung, Leerzeichen und Unterstriche egal) */
export function detail(hit: DubizzleHit, ...keys: string[]): string {
  const norm = (s: string) => s.toLowerCase().replace(/[\s_.-]+/g, '');
  const wanted = keys.map(norm);
  for (const bag of [hit.details, hit.details_v2]) {
    if (!bag) continue;
    for (const [k, v] of Object.entries(bag)) {
      if (wanted.includes(norm(k))) { const t = detailText(v).trim(); if (t) return t; }
    }
  }
  return '';
}

/** Leistung aus „300 - 399 HP“ / „400+ HP“ / „250 HP“ → kW (Bereichsmitte; sehr breite Bereiche → null) */
export function dubizzlePowerKw(text: string): number | null {
  const nums = (text.match(/\d{2,4}/g) ?? []).map(Number).filter((n) => n >= 40 && n <= 1500);
  if (!nums.length) return null;
  if (nums.length >= 2 && nums[1] - nums[0] > 150) return null;
  const hp = nums.length >= 2 ? (nums[0] + nums[1]) / 2 : nums[0];
  return Math.round(hp * 0.7457);
}

export function dubizzlePhotos(hit: DubizzleHit): string[] {
  const out: string[] = [];
  const push = (u: unknown) => { const s = str(u).trim(); if (/^https?:\/\//.test(s) && !out.includes(s)) out.push(s); };
  const walk = (v: unknown, depth: number) => {
    if (v == null || depth > 3) return;
    if (typeof v === 'string') return push(v);
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (o.main != null) push(o.main);
      else for (const x of Object.values(o)) walk(x, depth + 1);
    }
  };
  walk(hit.photos, 0);
  if (!out.length) walk(hit.photo_thumbnails, 0);
  return out;
}

export function dubizzleUrl(hit: DubizzleHit): string | null {
  const abs = detailText(hit.absolute_url) || str(hit.permalink) || str(hit.short_url);
  if (!abs) return null;
  if (/^https?:\/\//.test(abs)) return abs;
  return `https://uae.dubizzle.com${abs.startsWith('/') ? '' : '/'}${abs}`;
}

export function dubizzleLocation(hit: DubizzleHit): string {
  const v = hit.location_list as unknown;
  const list: unknown[] = Array.isArray(v) ? v : v && typeof v === 'object' && Array.isArray((v as { en?: unknown }).en) ? ((v as { en: unknown[] }).en) : v ? [v] : [];
  const names = list.map((x) => detailText(x).trim()).filter(Boolean);
  // Dubizzle führt Emirat/Stadt zuerst („Dubai“, „Al Quoz“) – Stadt reicht für die Kachel
  return names[0] ?? 'Dubai';
}

export function dubizzleSkipReason(hit: DubizzleHit): string | null {
  if (hit.is_price_hidden) return 'Preis auf Anfrage';
  if (hit.is_reserved) return 'reserviert';
  if (hit.is_coming_soon) return 'noch nicht verfügbar';
  const price = num(hit.price) ?? 0;
  if (price <= 0) return 'kein Preis';
  return null;
}

export function mapDubizzle(hit: DubizzleHit, fetchedAt: string): Listing | null {
  const externalId = str(hit.uuid || hit.objectID || hit.id);
  const price = num(hit.price) ?? 0;
  const year = num(detail(hit, 'Year', 'year'));
  const title = detailText(hit.name).trim();
  const make = canonicalMake(detail(hit, 'Make', 'make') || title.split(' ')[0] || '');
  const model = detail(hit, 'Model', 'model');
  if (!externalId || price <= 0 || !year || year < 1950 || !make || !model) return null;
  if (dubizzleSkipReason(hit)) return null;
  const trimText = detail(hit, 'Trim', 'Motors Trim', 'motors_trim', 'trim');
  const specs = detail(hit, 'Regional Specs', 'regional_specs').replace(/\bspecs?\b/i, '').trim();
  const fuelText = detail(hit, 'Fuel Type', 'fuel_type', 'fuel');
  const fuel = normalizeFuel(fuelText);
  const gear = detail(hit, 'Transmission Type', 'transmission_type', 'transmission');
  const cylinders = num(detail(hit, 'No. of Cylinders', 'cylinders', 'no_of_cylinders'));
  const steeringText = detail(hit, 'Steering Side', 'steering_side', 'steering').toLowerCase();
  const powerText = detail(hit, 'Horsepower', 'horsepower', 'hp');
  const bodyType = detail(hit, 'Body Type', 'body_type');
  const seller = str(hit.seller_type).trim();
  const photos = dubizzlePhotos(hit);
  const km = Math.round(num(detail(hit, 'Kilometers', 'kilometers', 'Mileage', 'mileage', 'km')) ?? 0);

  return {
    id: listingId('dubizzle', externalId),
    source: 'dubizzle',
    externalId,
    market: 'GCC',
    country: 'ae',
    location: dubizzleLocation(hit),
    offerType: 'fixed',
    url: dubizzleUrl(hit),
    year,
    make,
    model,
    trim: [trimText, specs ? `${specs} spec` : null, bodyType || null, seller ? `Seller: ${seller}` : null].filter(Boolean).join(' · ').slice(0, 160),
    km,
    engine: fuel === 'Electric' ? 'EV' : cylinders ? `${cylinders}-cyl` : '',
    engineCcm: null,
    powerKw: dubizzlePowerKw(powerText),
    co2Gkm: null,
    transmission: /manual/i.test(gear) ? 'Manual' : normalizeTransmission(gear || 'automatic'),
    drive: encarDrive(`${title} ${trimText}`, make),
    fuel,
    price,
    currency: 'AED',
    steering: steeringText.includes('right') ? 'RHD' : 'LHD',
    auction: null,
    coc: false,
    classic: new Date().getFullYear() - year >= 30,
    dutyRateOverride: null,
    originProof: false,
    resaleEur: null,
    partnerId: defaultPartnerFor('GCC'),
    photos,
    photoCount: Math.max(photos.length, num(hit.photos_count) ?? 0),
    damage: [],
    fetchedAt,
    active: true,
  };
}

export class DubizzleProvider implements MarketProvider {
  readonly id = 'dubizzle';
  readonly label = 'Dubizzle Motors (VAE, Algolia-Proxy)';

  enabled(): boolean {
    return config.dubizzle.enabled;
  }

  async fetchPage(band: PriceBand, page: number, hitsPerPage = config.dubizzle.hitsPerPage): Promise<{ hits: DubizzleHit[]; total: number; pages: number; raw: unknown }> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await robustFetch(DUBIZZLE_ENDPOINT, {
          method: 'POST', headers: dubizzleHeaders(), body: dubizzleBody(band, page, hitsPerPage),
          timeoutMs: 30000, proxyUrl: config.dubizzle.proxyUrl || undefined, nodeOnly: true, tls: 'chrome',
        });
        const body = await res.text();
        if (!res.ok) {
          const err = new HttpError(res.status, DUBIZZLE_ENDPOINT, body, Number(res.headers.get('retry-after')) || null);
          if (res.status === 429 || res.status >= 500 || res.status === 403) { lastErr = err; await sleep(Math.min(8000, 800 * 2 ** attempt)); continue; }
          throw err;
        }
        let raw: DubizzleResponse;
        try { raw = JSON.parse(body) as DubizzleResponse; } catch { throw new Error(`Dubizzle: keine JSON-Antwort (${body.slice(0, 80).replace(/\s+/g, ' ')})`); }
        const r = raw.results?.[0];
        if (!r) throw new Error(`Dubizzle: Antwort ohne results (${(raw.message ?? body.slice(0, 80)).replace(/\s+/g, ' ')})`);
        return { hits: r.hits ?? [], total: num(r.nbHits) ?? (r.hits?.length ?? 0), pages: num(r.nbPages) ?? 1, raw };
      } catch (e) {
        if (e instanceof HttpError) throw e;
        lastErr = e;
        await sleep(500 * 2 ** attempt);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  async fetchAll(): Promise<ProviderResult> {
    const fetchedAt = new Date().toISOString();
    const listings: Listing[] = [];
    const seen = new Set<string>();
    const skipped = new Map<string, number>();
    const warnings: string[] = [];
    const queue = initialBands(config.dubizzle.minPriceAed);
    const hitsPerPage = config.dubizzle.hitsPerPage;
    let requests = 0;
    let failed = 0;
    let truncated = 0;
    let bandsDone = 0;
    let total: number | null = null;
    try { total = await dubizzleTotal(this); requests++; } catch { /* Gesamtzahl ist nur fürs Protokoll */ }
    const skip = (why: string) => skipped.set(why, (skipped.get(why) ?? 0) + 1);
    const take = (hits: DubizzleHit[]) => {
      for (const hit of hits) {
        const why = dubizzleSkipReason(hit);
        if (why) { skip(why); continue; }
        const l = mapDubizzle(hit, fetchedAt);
        if (!l) { skip('unvollständig'); continue; }
        if (l.year < config.dubizzle.minYear) { skip(`vor ${config.dubizzle.minYear}`); continue; }
        if (!seen.has(l.id)) { seen.add(l.id); listings.push(l); }
      }
    };

    while (queue.length && requests < config.dubizzle.maxRequests) {
      const band = queue.shift()!;
      try {
        const first = await this.fetchPage(band, 0, hitsPerPage);
        requests++;
        if (first.total > ALGOLIA_HIT_LIMIT) {
          const halves = splitBand(band);
          if (halves) { queue.unshift(...halves); await sleep(config.dubizzle.delayMs); continue; }
          truncated++;
          warnings.push(`${band[0]}–${band[1] ?? '∞'} AED: ${first.total} Treffer, nur ${ALGOLIA_HIT_LIMIT} abrufbar`);
        }
        take(first.hits);
        const pages = Math.min(first.pages, Math.ceil(Math.min(first.total, ALGOLIA_HIT_LIMIT) / hitsPerPage));
        for (let page = 1; page < pages && requests < config.dubizzle.maxRequests; page++) {
          await sleep(config.dubizzle.delayMs);
          const r = await this.fetchPage(band, page, hitsPerPage);
          requests++;
          take(r.hits);
          if (r.hits.length < hitsPerPage) break;
        }
        bandsDone++;
      } catch (e) {
        failed++;
        warnings.push(`${band[0]}–${band[1] ?? '∞'} AED: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}`);
        if (failed >= 5 && bandsDone === 0) throw new Error(`Dubizzle: die ersten Preisfenster schlagen fehl – ${warnings.slice(0, 2).join(' | ')}`);
      }
      await sleep(config.dubizzle.delayMs);
    }
    if (bandsDone === 0) throw new Error(`Dubizzle: kein Preisfenster geladen – ${warnings.slice(0, 2).join(' | ')}`);
    const leftover = queue.length;
    const skipInfo = [...skipped.entries()].map(([k, n]) => `${n}× ${k}`).join(', ');
    warnings.push(`${listings.length} Inserate${total != null ? ` von ${total} Gebrauchtwagen` : ''} aus ${bandsDone} Preisfenstern (${requests} Anfragen)${leftover ? ` · ${leftover} Fenster nicht mehr abgefragt (DUBIZZLE_MAX_REQUESTS)` : ''}${skipInfo ? ` · übersprungen: ${skipInfo}` : ''}`);
    // vollständig nur, wenn jedes Fenster geladen wurde und keines über der Algolia-Grenze abgeschnitten ist
    return { listings, complete: failed === 0 && truncated === 0 && leftover === 0 && listings.length > 0, warnings };
  }
}

/** Gesamtzahl der Gebrauchtwagen (eine Anfrage) – für Probe und Protokoll */
export async function dubizzleTotal(p: DubizzleProvider): Promise<number> {
  const r = await p.fetchPage([0, null], 0, 1);
  return r.total;
}
