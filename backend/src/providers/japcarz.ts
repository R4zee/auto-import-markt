import { config } from '../config.js';
import { canonicalMake } from '../domain/makes.js';
import type { Listing } from '../domain/types.js';
import { defaultPartnerFor } from '../seed/partners.js';
import { encarDrive } from './encar.js';
import { getJson, num, sleep, str } from './http.js';
import { listingId, type MarketProvider, type ProviderResult } from './types.js';

/**
 * Jap Carz (Japan, jap-carz.com) – Exporteur, der Fahrzeuge der japanischen Auktionshäuser anbietet. JSON-API der
 * Website, kein Key (Netzwerk-Tab und Probe 20.09.2026, 475 Fahrzeuge):
 *
 *   GET https://jap-carz.com/api/listings/?sort=upcoming_auctions&per_page=30&page=1
 *   → { data: Item[], meta: { current_page, last_page, per_page, total }, filters }
 *
 * Item: lot, hash, slug (Bild-/Detailpfad), title ("BMW 3 SERIES 325I M-SPORT PACKAGE"), subtitle, make{name,slug},
 * model{name,slug} (Modell + Ausstattung, teils doppelt), year, parsed_mileage ("288000 km"), parsed_displacement ("3000"),
 * parsed_transmission ("AT"/"MT"), parsed_starting_bid (JPY), parsed_final_price (JPY, nach der Auktion), steering_wheel
 * ("lhd"/"rhd"), auction_date ("2026-09-22"), auction_time ("08:00", Japan), auction_result ("non Auction" = steht noch aus),
 * site (Auktionsplatz, z. B. "R-Nagoya", "Yokohama"), grade_label (Auktionsnote), cover, preview_images[] (relativ), photo_count,
 * equipment[], has*-Flags.
 */
export interface JapCarzItem {
  lot?: string | number; hash?: string; slug?: string; title?: string; subtitle?: string;
  make?: { name?: string; slug?: string } | string | null; model?: { name?: string; slug?: string } | string | null;
  year?: number | string; parsed_mileage?: string | number | null; parsed_displacement?: string | number | null;
  parsed_transmission?: string | null; parsed_starting_bid?: string | number | null; parsed_final_price?: string | number | null;
  steering_wheel?: string | null; auction_date?: string | null; auction_time?: string | null; auction_result?: string | null;
  site?: string | null; grade_label?: string | null; cover?: string | null; preview_images?: string[] | null; photo_count?: number | string;
  equipment?: string[] | null; hasSunroof?: boolean | null; hasLeatherSeats?: boolean | null; hasNavigation?: boolean | null; has_navi?: boolean | null;
}
export interface JapCarzResponse { data?: JapCarzItem[]; meta?: { current_page?: number; last_page?: number; per_page?: number; total?: number } }

export const JAPCARZ_BASE = 'https://jap-carz.com';

export function japcarzUrl(page: number, perPage = config.japcarz.perPage, sort = config.japcarz.sort): string {
  return `${JAPCARZ_BASE}/api/listings/?sort=${encodeURIComponent(sort)}&per_page=${perPage}&page=${page}`;
}

export function japcarzImage(path: string | null | undefined): string | null {
  const p = str(path).trim();
  if (!p) return null;
  return /^https?:\/\//.test(p) ? p : `${JAPCARZ_BASE}${p.startsWith('/') ? '' : '/'}${p}`;
}

/** Auktionstermin (japanische Ortszeit, UTC+9) als ISO-Zeitpunkt */
export function japcarzEndsAt(date: string | null | undefined, time: string | null | undefined): Date | null {
  const d = str(date).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const t = /^\d{1,2}:\d{2}$/.test(str(time).trim()) ? str(time).trim().padStart(5, '0') : '09:00';
  const at = new Date(`${d}T${t}:00+09:00`);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * Modell und Ausstattung aus dem Titel ohne Marke: "3 SERIES 325I M-SPORT PACKAGE" → Modell "3 Series", Ausstattung
 * "325I M-Sport Package". Zwei Wörter, wenn das erste kurz ist (Ziffer/Buchstabe) oder das zweite SERIES/CLASS heißt.
 */
export function japcarzModel(titleSansMake: string, make = ''): { model: string; trim: string } {
  const words = titleSansMake.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return { model: '', trim: '' };
  // "ALFA SPORTWAGON" bei Marke ALFA-ROMEO: das erste Wort gehört zur Marke → Modell aus zwei Wörtern
  const makeWords = make.toUpperCase().split(/[\s-]+/).filter(Boolean);
  const two = words.length > 1 && (words[0].length <= 2 || /^(SERIES|CLASS|KLASSE|SERIE)$/i.test(words[1]) || makeWords.includes(words[0].toUpperCase()));
  const n = two ? 2 : 1;
  const tc = (w: string) => (/^[A-Z0-9-]{1,3}$/.test(w) || /\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return { model: words.slice(0, n).map(tc).join(' '), trim: words.slice(n).map(tc).join(' ') };
}

export function japcarzSkipReason(v: JapCarzItem): string | null {
  if (str(v.steering_wheel).toLowerCase() === 'rhd') return 'Rechtslenker';
  if (num(v.parsed_final_price)) return 'bereits versteigert';
  const result = str(v.auction_result).toLowerCase();
  if (result && !/non|upcoming|pending|scheduled/.test(result)) return `Auktion beendet (${str(v.auction_result)})`;
  const ends = japcarzEndsAt(v.auction_date, v.auction_time);
  if (ends && ends.getTime() < Date.now()) return 'Auktionstermin liegt zurück';
  if (!(num(v.parsed_starting_bid) ?? 0)) return 'kein Startgebot';
  return null;
}

export function mapJapCarz(v: JapCarzItem, fetchedAt: string): Listing | null {
  const externalId = str(v.slug || v.hash || v.lot).trim();
  const year = num(v.year);
  const makeRaw = typeof v.make === 'string' ? v.make : str(v.make?.name);
  const make = canonicalMake(makeRaw.replace(/-/g, ' ')) || canonicalMake(makeRaw);
  const title = str(v.title).replace(/\s+/g, ' ').trim();
  const sansMake = title.replace(new RegExp(`^${makeRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '').trim() || str(v.subtitle);
  const { model, trim } = japcarzModel(sansMake, makeRaw);
  const price = num(v.parsed_starting_bid) ?? 0;
  if (!externalId || !year || !make || !model || price <= 0) return null;
  if (japcarzSkipReason(v)) return null;
  const km = Math.round(num(v.parsed_mileage) ?? 0);
  const ccmRaw = num(v.parsed_displacement);
  const ccm = ccmRaw && ccmRaw >= 500 && ccmRaw <= 9000 ? Math.round(ccmRaw) : null;
  const text = `${title} ${trim}`.toUpperCase();
  const fuel: Listing['fuel'] = /\bEV\b|ELECTRIC/.test(text) ? 'Electric' : /HYBRID|PHEV/.test(text) ? 'Hybrid' : /DIESEL|TDI|\bTD\b|CDI|\bD4D\b|D-4D/.test(text) ? 'Diesel' : 'Petrol';
  const trans = str(v.parsed_transmission).toUpperCase();
  const endsAt = japcarzEndsAt(v.auction_date, v.auction_time);
  const photos = [v.cover, ...(v.preview_images ?? [])].map(japcarzImage).filter((p, i, a): p is string => !!p && a.indexOf(p) === i);
  const extras = [v.hasSunroof ? 'Sunroof' : '', v.hasLeatherSeats ? 'Leather' : '', v.hasNavigation || v.has_navi ? 'Navi' : ''].filter(Boolean);
  const site = str(v.site).trim();

  return {
    id: listingId('japcarz', externalId),
    source: 'japcarz',
    externalId,
    market: 'JP',
    country: 'jp',
    location: site.replace(/^[A-Z]-/, ''),
    offerType: 'auction',
    url: `${JAPCARZ_BASE}${config.japcarz.detailPath.replace('{slug}', encodeURIComponent(str(v.slug || v.hash)))}`,
    year,
    make,
    model,
    trim: [trim, extras.join(' · ')].filter(Boolean).join(' · ').slice(0, 160),
    km,
    engine: fuel === 'Electric' ? 'EV' : ccm ? `${(ccm / 1000).toFixed(1)} L` : '',
    engineCcm: fuel === 'Electric' ? null : ccm,
    co2Gkm: null,
    transmission: trans.startsWith('M') ? 'Manual' : 'Automatic',
    drive: encarDrive(`${title} ${trim}`, make),
    fuel,
    price,
    currency: 'JPY',
    steering: str(v.steering_wheel).toLowerCase() === 'rhd' ? 'RHD' : 'LHD',
    auction: {
      house: site ? `Jap Carz · ${site}` : 'Jap Carz',
      lot: str(v.lot) || externalId,
      grade: str(v.grade_label).trim() || null,
      gradeNote: v.equipment?.length ? v.equipment.join(', ') : null,
      hammerLow: null,
      hammerHigh: null,
      endsAt: (endsAt ?? new Date(Date.now() + 7 * 86400000)).toISOString(),
    },
    coc: false,
    classic: new Date().getFullYear() - year >= 30,
    dutyRateOverride: null,
    originProof: false,
    resaleEur: null,
    partnerId: defaultPartnerFor('JP'),
    photos,
    photoCount: Math.max(photos.length, num(v.photo_count) ?? 0),
    damage: [],
    fetchedAt,
    active: true,
  };
}

export class JapCarzProvider implements MarketProvider {
  readonly id = 'japcarz';
  readonly label = 'Jap Carz (Japan, JSON-API)';

  enabled(): boolean {
    return config.japcarz.enabled;
  }

  async fetchPage(page: number, perPage = config.japcarz.perPage): Promise<JapCarzResponse> {
    return getJson<JapCarzResponse>(japcarzUrl(page, perPage), {
      headers: { Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9', Referer: `${JAPCARZ_BASE}/`, 'User-Agent': config.europe.userAgent },
      timeoutMs: 30000, proxyUrl: config.japcarz.proxyUrl || undefined, nodeOnly: true, retries: 2,
    });
  }

  async fetchAll(): Promise<ProviderResult> {
    const fetchedAt = new Date().toISOString();
    const listings: Listing[] = [];
    const seen = new Set<string>();
    const skipped = new Map<string, number>();
    let lastPage = 1;
    let total: number | null = null;
    let page = 1;
    for (; page <= lastPage && page <= config.japcarz.maxPages; page++) {
      const r = await this.fetchPage(page);
      lastPage = num(r.meta?.last_page) ?? lastPage;
      total = num(r.meta?.total) ?? total;
      const items = r.data ?? [];
      for (const v of items) {
        const why = japcarzSkipReason(v);
        if (why) { skipped.set(why, (skipped.get(why) ?? 0) + 1); continue; }
        const l = mapJapCarz(v, fetchedAt);
        if (!l) { skipped.set('unvollständig', (skipped.get('unvollständig') ?? 0) + 1); continue; }
        if (l.year < config.japcarz.minYear) { skipped.set(`vor ${config.japcarz.minYear}`, (skipped.get(`vor ${config.japcarz.minYear}`) ?? 0) + 1); continue; }
        if (!seen.has(l.id)) { seen.add(l.id); listings.push(l); }
      }
      if (!items.length) break;
      if (page < lastPage) await sleep(config.japcarz.delayMs);
    }
    const complete = lastPage <= config.japcarz.maxPages;
    const skipInfo = [...skipped.entries()].map(([k, n]) => `${n}× ${k}`).join(', ');
    return { listings, complete, warnings: [`${listings.length} Fahrzeuge${total != null ? ` von ${total}` : ''} aus ${Math.min(page - 1, lastPage)} Seiten${skipInfo ? ` · übersprungen: ${skipInfo}` : ''}${complete ? '' : ` · nur ${config.japcarz.maxPages} von ${lastPage} Seiten (JAPCARZ_MAX_PAGES)`}`] };
  }
}
