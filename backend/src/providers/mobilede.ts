import { config } from '../config.js';
import { makeKey } from '../domain/makes.js';
import type { Fuel } from '../domain/types.js';
import { HttpError, num, robustFetch, sleep, str } from './http.js';

/**
 * mobile.de als Quelle für deutsche Vergleichspreise (kein Inserate-Import). Genutzt wird der JSON-Endpunkt der
 * mobile.de-Web-App `/consumer/api/search/srp?url=<search.html-Adresse>` (Header `x-mobile-client`). Kein Key,
 * keine Anmeldung – Grauzone wie Encar, deshalb per REFERENCE_ENABLED schaltbar.
 * Live bestätigt 15.09.2026 (`npm run probe -- mobile BMW 320d 2019 Diesel`: HTTP 200, 730 Treffer, 37 Seiten):
 * Antwort `searchResults{numResultsTotal,numPages,hasNextPage,items[]}`, je Treffer `id`, `title`, `subTitle`,
 * `price{gross,grossAmount}`, `attr{fr:"05/2020", ml:"130.000 km", pw:"140 kW (190 PS)", cc:"1.995 cm³", ft, tr, loc, cn}`,
 * `relativeUrl`, `priceRating{rating,thresholdLabels}`. Die Parameter direkt an /srp (ohne `url=`) liefern HTTP 400.
 */
export interface RefSample {
  priceEur: number;
  year: number;
  km: number;
  kw: number | null;
  ccm: number | null;
  title: string;
  url: string | null;
}

export interface RefQuery {
  make: string;
  /** Modell-/Variantentext für die Beschreibungssuche (z. B. "320d", "E 220 d", "Tucson") */
  description: string;
  yearFrom: number;
  yearTo: number;
  fuel: Fuel | null;
  /** Baureihe, aus der das Baujahrband stammt (nur zur Anzeige) */
  generation?: string | null;
}

/** mobile.de-Marken-IDs (Parameter `ms=<id>;;;<Beschreibung>`), Schlüssel = makeKey des kanonischen Namens */
const MAKE_IDS: Record<string, number> = {
  abarth: 140, alfaromeo: 900, astonmartin: 1750, audi: 1900, bentley: 3100, bmw: 3500, bugatti: 3800, buick: 4000, cadillac: 4400,
  chevrolet: 5600, chrysler: 5700, citroen: 5900, dacia: 6600, daewoo: 6700, daihatsu: 6800, dodge: 7400, ferrari: 8600, fiat: 8800,
  ford: 9000, gmc: 9900, honda: 11000, hummer: 11500, hyundai: 11600, infiniti: 11650, isuzu: 12200, jaguar: 12400, jeep: 12600,
  kia: 13200, lada: 13900, lamborghini: 14400, lancia: 14500, landrover: 14600, lexus: 15200, lincoln: 15400, lotus: 15500,
  maserati: 16600, mazda: 16800, mclaren: 16900, mercedesbenz: 17200, mg: 17500, mini: 17700, mitsubishi: 17900, nissan: 18700,
  opel: 19000, peugeot: 19800, polestar: 20000, pontiac: 20050, porsche: 20100, ram: 20200, renault: 21600, rollsroyce: 21700,
  rover: 21800, saab: 21900, seat: 22500, skoda: 22900, smart: 23000, ssangyong: 23100, subaru: 23600, suzuki: 23800, tesla: 135,
  toyota: 24100, volkswagen: 25200, volvo: 25100, cupra: 6325, ds: 7300, byd: 4200, genesis: 8501, kgmobility: 23100,
};

export function mobileMakeId(make: string): number | null {
  const key = makeKey(make);
  const override = Object.entries(config.reference.makeIds).find(([k]) => makeKey(k) === key);
  if (override && Number.isFinite(override[1])) return override[1];
  return MAKE_IDS[key] ?? null;
}

export const MOBILE_FUEL: Record<Fuel, string> = { Petrol: 'PETROL', Diesel: 'DIESEL', Hybrid: 'HYBRID', Electric: 'ELECTRICITY' };

/** Klassische Suchparameter (suchen.mobile.de/fahrzeuge/search.html), günstigste zuerst, nur unbeschädigte Pkw aus Deutschland */
export function mobileSearchParams(q: RefQuery, page = 1): URLSearchParams {
  const makeId = mobileMakeId(q.make);
  const sp = new URLSearchParams();
  sp.set('isSearchRequest', 'true');
  sp.set('s', 'Car');
  sp.set('vc', 'Car');
  sp.set('cn', 'DE');
  sp.set('dam', '0');
  sp.set('ms', `${makeId ?? ''};;;${q.description}`);
  sp.set('fr', `${q.yearFrom}:${q.yearTo}`);
  if (q.fuel) sp.set('ft', MOBILE_FUEL[q.fuel]);
  sp.set('sb', 'p');
  sp.set('od', 'up');
  if (page > 1) sp.set('pageNumber', String(page));
  return sp;
}

export function mobileSearchUrl(q: RefQuery, page = 1): string {
  return `https://suchen.mobile.de/fahrzeuge/search.html?${mobileSearchParams(q, page)}`;
}

export function mobileApiUrl(q: RefQuery, page = 1, mode: 'query' | 'url' = config.reference.mobileMode): string {
  if (mode === 'url') return `https://www.mobile.de/consumer/api/search/srp?url=${encodeURIComponent(mobileSearchUrl(q, page))}`;
  return `https://www.mobile.de/consumer/api/search/srp?${mobileSearchParams(q, page)}`;
}

export function mobileHeaders(): Record<string, string> {
  return {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'de-DE,de;q=0.9,en;q=0.7',
    'User-Agent': config.reference.userAgent,
    'x-mobile-client': 'de.mobile.consumer-webapp',
    Referer: 'https://www.mobile.de/',
    Origin: 'https://www.mobile.de',
  };
}

/** Erste Zahl aus Texten wie "85.000 km", "12.900 €", "140 kW (190 PS)", "1.995 cm³" (Tausenderpunkte entfernt) */
export function firstInt(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
  if (typeof v !== 'string') return null;
  const m = v.replace(/\.(?=\d{3}\b)/g, '').match(/-?\d+/);
  return m ? Number(m[0]) : null;
}

function yearOf(v: unknown): number | null {
  if (typeof v === 'number') return v >= 1900 && v <= 2100 ? v : null;
  if (typeof v !== 'string') return null;
  const m = v.match(/(19|20)\d{2}/);
  return m ? Number(m[0]) : null;
}

/** Trefferliste aus verschiedenen Antwortformen ziehen (searchResults.items, items, data.items, listings) */
export function extractItems(json: unknown): unknown[] {
  const j = json as Record<string, unknown> | null;
  if (!j || typeof j !== 'object') return [];
  const candidates: unknown[] = [
    (j.searchResults as Record<string, unknown> | undefined)?.items,
    (j.searchResults as Record<string, unknown> | undefined)?.listings,
    j.items, j.listings, (j.data as Record<string, unknown> | undefined)?.items, (j.data as Record<string, unknown> | undefined)?.listings,
  ];
  const arr = candidates.find((c) => Array.isArray(c)) as unknown[] | undefined;
  return arr ?? [];
}

export function extractTotal(json: unknown): { total: number | null; numPages: number | null; hasNext: boolean | null } {
  const j = json as Record<string, unknown> | null;
  const sr = (j?.searchResults as Record<string, unknown> | undefined) ?? j ?? {};
  return {
    total: num(sr.numResultsTotal ?? sr.total ?? sr.numResults ?? j?.numResultsTotal),
    numPages: num(sr.numPages ?? j?.numPages),
    hasNext: typeof sr.hasNextPage === 'boolean' ? sr.hasNextPage : null,
  };
}

/** Ein Suchtreffer → Stichprobe; Werbeplätze/Teaser ohne Preis oder Erstzulassung werden verworfen */
export function mapMobileItem(item: unknown): RefSample | null {
  const it = item as Record<string, unknown> | null;
  if (!it || typeof it !== 'object') return null;
  const price = it.price as Record<string, unknown> | number | string | undefined;
  const priceEur = typeof price === 'object' && price
    ? firstInt(price.grossAmount ?? price.amount ?? price.gross ?? price.value ?? price.raw)
    : firstInt(price ?? it.priceGross ?? it.grossPrice);
  const attr = (it.attr ?? it.attributes ?? {}) as Record<string, unknown>;
  const year = yearOf(attr.fr ?? it.firstRegistration ?? it.fr ?? attr.firstRegistration);
  const km = firstInt(attr.ml ?? it.mileage ?? it.ml ?? attr.mileage);
  const kw = firstInt(attr.pw ?? it.power ?? it.pw ?? attr.power);
  const ccm = firstInt(attr.cc ?? attr.ccm ?? attr.cubicCapacity ?? it.cubicCapacity ?? it.cc);
  if (priceEur == null || priceEur <= 0 || year == null || km == null) return null;
  const rel = str(it.relativeUrl ?? it.url ?? it.link ?? it.vipUrl);
  const url = rel ? (rel.startsWith('http') ? rel : `https://suchen.mobile.de${rel.startsWith('/') ? '' : '/'}${rel}`) : it.id != null ? `https://suchen.mobile.de/fahrzeuge/details.html?id=${str(it.id)}` : null;
  return { priceEur, year, km, kw, ccm, title: str(it.title ?? it.headline ?? it.name), url };
}

export class MobileDeReference {
  readonly id = 'mobilede';
  readonly label = 'mobile.de (Vergleichspreise DE)';

  enabled(): boolean {
    return config.reference.enabled;
  }

  async fetchPage(q: RefQuery, page: number, mode: 'query' | 'url' = config.reference.mobileMode): Promise<{ items: RefSample[]; raw: unknown; url: string; total: number | null; numPages: number | null; hasNext: boolean | null }> {
    const url = mobileApiUrl(q, page, mode);
    const res = await robustFetch(url, { headers: mobileHeaders(), timeoutMs: 25000, proxyUrl: config.reference.proxyUrl || undefined, nodeOnly: true, tls: 'chrome' });
    const body = await res.text();
    if (!res.ok) throw new HttpError(res.status, url, body, null);
    let raw: unknown;
    try { raw = JSON.parse(body); } catch { throw new Error(`mobile.de: keine JSON-Antwort (${body.slice(0, 80).replace(/\s+/g, ' ')})`); }
    const items = extractItems(raw).map(mapMobileItem).filter((s): s is RefSample => s !== null);
    return { items, raw, url, ...extractTotal(raw) };
  }

  /** Bis zu `pages` Seiten (günstigste zuerst); Stichproben preisaufsteigend */
  async fetchSamples(q: RefQuery, pages = config.reference.pages): Promise<{ samples: RefSample[]; total: number | null; url: string }> {
    const samples: RefSample[] = [];
    let total: number | null = null;
    let url = '';
    for (let page = 1; page <= pages; page++) {
      const r = await this.fetchPage(q, page);
      if (page === 1) { total = r.total; url = mobileSearchUrl(q); }
      samples.push(...r.items);
      const more = r.hasNext ?? (r.numPages != null ? page < r.numPages : r.items.length >= 20);
      if (!more || !r.items.length) break;
      await sleep(config.reference.delayMs);
    }
    samples.sort((a, b) => a.priceEur - b.priceEur);
    return { samples, total, url };
  }
}
