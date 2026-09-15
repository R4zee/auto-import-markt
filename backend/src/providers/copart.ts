import { config } from '../config.js';
import { canonicalMake } from '../domain/makes.js';
import type { Listing } from '../domain/types.js';
import { defaultPartnerFor } from '../seed/partners.js';
import { HttpError, num, robustFetch, sleep, str } from './http.js';
import { listingId, milesToKm, normalizeDrive, normalizeFuel, normalizeTransmission, type MarketProvider, type ProviderResult } from './types.js';

/**
 * Copart (USA) über den Suchendpunkt der Website (`POST /public/lots/search-results`), den die öffentliche Suche
 * ohne Login nutzt. Kein Key – Grauzone wie Encar, deshalb per COPART_ENABLED schaltbar und mit
 * `npm run probe -- copart` vor dem Einschalten prüfbar. Feldnamen sind Kurzschlüssel der Copart-Antwort
 * (ln = Losnummer, mkn = Marke, lm = Modell, lcy = Baujahr, orr = Tacho, hb = Höchstgebot, bnp = Sofortkauf,
 * ad = Auktionstermin, yn = Standort, dd = Hauptschaden, tims = Vorschaubild …) und werden tolerant gelesen.
 */
export interface CopartLot {
  ln?: number | string; mkn?: string; lm?: string; lmg?: string; lcy?: number | string; orr?: number | string; ord?: string;
  hb?: number | string; bnp?: number | string; ad?: number | string; yn?: string; ynumb?: number | string; dd?: string; sdd?: string;
  ft?: string; tmtp?: string; drv?: string; egn?: string; cy?: number | string; tims?: string; tt?: string; tgc?: string; lcd?: string;
  hk?: string; fv?: string; lcc?: string; lstg?: string; lu?: string; cuv?: string; ts?: string; lcu?: string; syn?: string; ldu?: string;
}

export function copartBody(page: number, size: number, makes: string[] = []): Record<string, unknown> {
  const filter: Record<string, string[]> = { MISC: ['#VehicleTypeCode:VEHTYPE_V'] };
  if (makes.length) filter.MAKE = makes.map((m) => `#Make:${m.toUpperCase()}`);
  return {
    query: ['*'], filter, sort: ['auction_date_type desc', 'auction_date_utc asc'],
    page, size, start: page * size, watchListOnly: false, freeFormSearch: false, hideImages: false, defaultSort: false,
    specificRowProvided: false, displayName: '', searchName: '', backUrl: '', includeTagByField: {}, rawParams: {},
  };
}

export function copartPhoto(thumb: string | undefined): string | null {
  if (!thumb) return null;
  return thumb.replace(/_thb(\.jpg)?$/i, '_ful$1').replace(/_thb\./i, '_ful.');
}

export function mapCopart(v: CopartLot, fetchedAt: string): Listing | null {
  const lot = str(v.ln);
  const year = num(v.lcy);
  const make = canonicalMake(str(v.mkn));
  const model = str(v.lmg || v.lm);
  if (!lot || !year || !make || !model) return null;
  const bid = num(v.hb) ?? 0;
  const buyNow = num(v.bnp) ?? 0;
  const price = bid > 0 ? bid : buyNow;
  if (price <= 0) return null;
  const adMs = num(v.ad);
  const endsAt = adMs && adMs > 0 ? new Date(adMs > 1e12 ? adMs : adMs * 1000) : null;
  const isAuction = !!endsAt && !Number.isNaN(endsAt.getTime()) && endsAt.getTime() > Date.now();
  if (!isAuction && buyNow <= 0) return null;
  const odo = num(v.orr) ?? 0;
  const km = (v.ord ?? '').toUpperCase().startsWith('K') ? odo : milesToKm(odo);
  const yard = str(v.yn);
  const damage = str(v.dd);
  const runCond = str(v.lcd);
  const title = str(v.tt || v.tgc);
  const engine = str(v.egn);
  const litres = engine.match(/(\d\.\d)\s*L/i)?.[1];
  const photo = copartPhoto(str(v.tims) || undefined);

  return {
    id: listingId('copart', lot),
    source: 'copart',
    externalId: lot,
    market: 'US',
    country: 'us',
    location: yard.replace(/^[A-Z]{2}\s*-\s*/, '').trim(),
    offerType: isAuction ? 'auction' : 'fixed',
    url: `https://www.copart.com/lot/${lot}`,
    year,
    make,
    model,
    trim: [str(v.lm) !== model ? str(v.lm) : '', title ? `Title: ${title}` : '', damage ? `Damage: ${damage}` : ''].filter(Boolean).join(' · '),
    km: Math.round(km),
    engine: litres ? `${litres} L${v.cy ? ` ${str(v.cy)}-cyl` : ''}` : engine,
    engineCcm: litres ? Math.round(Number(litres) * 1000) : null,
    co2Gkm: null,
    transmission: normalizeTransmission(v.tmtp),
    drive: normalizeDrive(v.drv),
    fuel: normalizeFuel(v.ft === 'GAS' ? 'petrol' : v.ft),
    price: isAuction ? bid || buyNow : buyNow,
    currency: 'USD',
    steering: 'LHD',
    auction: isAuction
      ? {
          house: `Copart ${yard}`.trim(),
          lot,
          grade: runCond || null,
          gradeNote: [damage ? `Primary damage: ${damage}` : null, v.sdd ? `Secondary: ${v.sdd}` : null, v.hk ? (v.hk.toUpperCase().startsWith('Y') ? 'Keys present' : 'No keys') : null].filter(Boolean).join('. ') || null,
          hammerLow: null,
          hammerHigh: buyNow > 0 ? buyNow : null,
          endsAt: endsAt!.toISOString(),
        }
      : null,
    coc: false,
    classic: new Date().getFullYear() - year >= 30,
    dutyRateOverride: null,
    originProof: false,
    resaleEur: null,
    partnerId: defaultPartnerFor('US'),
    photos: photo ? [photo] : [],
    photoCount: photo ? 1 : 0,
    damage: [],
    fetchedAt,
    active: true,
  };
}

export function copartHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/plain, */*',
    'User-Agent': config.reference.userAgent,
    'Accept-Language': 'en-US,en;q=0.9',
    Origin: 'https://www.copart.com',
    Referer: 'https://www.copart.com/vehicleFinder',
  };
}

export class CopartProvider implements MarketProvider {
  readonly id = 'copart';
  readonly label = 'Copart (USA)';

  enabled(): boolean {
    return config.copart.enabled;
  }

  async fetchPage(page: number, size = config.copart.pageSize): Promise<{ lots: CopartLot[]; total: number | null; raw: unknown }> {
    const url = 'https://www.copart.com/public/lots/search-results';
    const res = await robustFetch(url, {
      method: 'POST', headers: copartHeaders(), body: JSON.stringify(copartBody(page, size, config.copart.makes)),
      timeoutMs: 30000, proxyUrl: config.copart.proxyUrl || undefined, nodeOnly: true, tls: 'chrome',
    });
    const body = await res.text();
    if (!res.ok) throw new HttpError(res.status, url, body, null);
    let raw: unknown;
    try { raw = JSON.parse(body); } catch { throw new Error(`Copart: keine JSON-Antwort (${body.slice(0, 80).replace(/\s+/g, ' ')})`); }
    const data = (raw as { data?: { results?: { content?: CopartLot[]; totalElements?: number } } }).data;
    return { lots: data?.results?.content ?? [], total: num(data?.results?.totalElements), raw };
  }

  async fetchAll(): Promise<ProviderResult> {
    const fetchedAt = new Date().toISOString();
    const listings: Listing[] = [];
    const seen = new Set<string>();
    let total: number | null = null;
    for (let page = 0; page < config.copart.pages; page++) {
      const r = await this.fetchPage(page);
      total = r.total;
      for (const lot of r.lots) {
        const l = mapCopart(lot, fetchedAt);
        if (l && l.year >= config.copart.minYear && !seen.has(l.id)) { seen.add(l.id); listings.push(l); }
      }
      if (r.lots.length < config.copart.pageSize) break;
      await sleep(config.copart.delayMs);
    }
    return { listings, complete: false, warnings: [`${listings.length} Lose${total != null ? ` von ${total}` : ''} (nur laufende Auktionen/Sofortkauf, ab ${config.copart.minYear})`] };
  }
}
