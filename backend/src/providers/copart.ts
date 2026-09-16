import { config } from '../config.js';
import { canonicalMake } from '../domain/makes.js';
import type { Listing } from '../domain/types.js';
import { defaultPartnerFor } from '../seed/partners.js';
import { HttpError, num, robustFetch, sleep, str } from './http.js';
import { listingId, milesToKm, normalizeDrive, normalizeFuel, normalizeTransmission, type MarketProvider, type ProviderResult } from './types.js';

/**
 * Copart (USA) über den Suchendpunkt der Website (`POST /public/lots/search-results`), den die öffentliche Suche
 * ohne Login nutzt. Kein Key – Grauzone wie Encar, deshalb per COPART_ENABLED schaltbar. Live bestätigt 15.09.2026
 * (`npm run probe -- copart`: 385.803 Lose). Feldnamen sind Kurzschlüssel der Antwort `data.results.content[]`:
 * ln Losnummer, mkn Marke, lmg/lm Modell, ltd Ausstattung, lcy Baujahr, orr Tacho (Meilen; ord = ACTUAL/NOT ACTUAL),
 * hb aktuelles Gebot, bnp Sofortkauf, ad Auktionstermin (ms), yn/locCity/locState/locCountry Standort, dd Schaden,
 * tgd Titelart ("SALVAGE TITLE"), lcd Zustand ("RUNS AND DRIVES"), hk Schlüssel, egn/cy Motor, tims Vorschaubild,
 * ldu URL-Slug. Lose ohne Gebot/Sofortkauf oder mit zurückliegendem Termin werden übersprungen und gezählt.
 */
export interface CopartLot {
  ln?: number | string; mkn?: string; lm?: string; lmg?: string; ltd?: string; lmtd?: string; ld?: string; lcy?: number | string;
  orr?: number | string; ord?: string; odometerUOM?: string;
  hb?: number | string; bnp?: number | string; ad?: number | string; lad?: number | string; yn?: string; ynumb?: number | string; dd?: string; sdd?: string;
  ft?: string; tmtp?: string; drv?: string; egn?: string; cy?: number | string; tims?: string; tt?: string; tgc?: string; tgd?: string; td?: string; lcd?: string;
  hk?: string; fv?: string; lcc?: string; lstg?: string; lu?: string; cuv?: string; ts?: string; lcu?: string; syn?: string; ldu?: string;
  locCity?: string; locState?: string; locCountry?: string; clr?: string; lotPlugAcv?: number | string; ess?: string; cuc?: string;
}

/** Warum ein Los nicht übernommen wurde (für Probe und Sync-Protokoll) */
export function copartSkipReason(v: CopartLot): string | null {
  if (v.locCountry && v.locCountry.toUpperCase() !== 'USA') return 'nicht USA';
  const bid = num(v.hb) ?? 0;
  const buyNow = num(v.bnp) ?? 0;
  if (bid <= 0 && buyNow <= 0) return 'noch kein Gebot, kein Sofortkauf';
  const adMs = num(v.ad);
  const endsAt = adMs && adMs > 0 ? new Date(adMs > 1e12 ? adMs : adMs * 1000) : null;
  const live = !!endsAt && !Number.isNaN(endsAt.getTime()) && endsAt.getTime() > Date.now();
  if (!live && buyNow <= 0) return 'Auktionstermin liegt zurück, kein Sofortkauf';
  return null;
}

export function copartBody(page: number, size: number, makes: string[] = []): Record<string, unknown> {
  const filter: Record<string, string[]> = { MISC: ['#VehicleTypeCode:VEHTYPE_V'] };
  if (makes.length) filter.MAKE = makes.map((m) => `#Make:${m.toUpperCase()}`);
  // Nach Auktionstermin aufsteigend: die ersten Seiten sind die heute bereits gelaufenen Verkäufe (Lauf 26: 1.981 von
  // 2.000 Losen mit zurückliegendem Termin) – fetchAll blättert weiter, bis genug künftige Termine beisammen sind
  return {
    query: ['*'], filter, sort: ['auction_date_utc asc'],
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
  if (copartSkipReason(v)) return null;
  const bid = num(v.hb) ?? 0;
  const buyNow = num(v.bnp) ?? 0;
  const adMs = num(v.ad);
  const endsAt = adMs && adMs > 0 ? new Date(adMs > 1e12 ? adMs : adMs * 1000) : null;
  const isAuction = !!endsAt && !Number.isNaN(endsAt.getTime()) && endsAt.getTime() > Date.now();
  // Tacho in Meilen (odometerUOM 'K' = km); ord = Tachobewertung (ACTUAL / NOT ACTUAL / EXEMPT), keine Einheit
  const odo = num(v.orr) ?? 0;
  const km = (v.odometerUOM ?? '').toUpperCase().startsWith('K') ? odo : milesToKm(odo);
  const yard = str(v.yn);
  const damage = str(v.dd);
  const runCond = str(v.lcd);
  const title = str(v.tgd || v.td || v.tt || v.tgc);
  const engine = str(v.egn).replace(/\s+/g, ' ');
  const litres = engine.match(/(\d\.\d)\s*L/i)?.[1];
  const photo = copartPhoto(str(v.tims) || undefined);
  const variant = str(v.ltd) || (str(v.lm) !== model ? str(v.lm) : '');
  const odoNote = v.ord && !/^ACTUAL$/i.test(str(v.ord)) ? `Odometer: ${str(v.ord)}` : '';

  return {
    id: listingId('copart', lot),
    source: 'copart',
    externalId: lot,
    market: 'US',
    country: 'us',
    location: str(v.locCity) || yard.replace(/^[A-Z]{2}\s*-\s*/, '').trim(),
    offerType: isAuction ? 'auction' : 'fixed',
    url: `https://www.copart.com/lot/${lot}${v.ldu ? `/${str(v.ldu)}` : ''}`,
    year,
    make,
    model,
    trim: [variant, title ? `Title: ${title}` : '', damage ? `Damage: ${damage}` : '', odoNote].filter(Boolean).join(' · '),
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
    const skipped = new Map<string, number>();
    let total: number | null = null;
    let pages = 0;
    for (let page = 0; page < config.copart.pages && listings.length < config.copart.maxLots; page++) {
      const r = await this.fetchPage(page);
      pages++;
      total = r.total;
      for (const lot of r.lots) {
        const reason = copartSkipReason(lot);
        if (reason) { skipped.set(reason, (skipped.get(reason) ?? 0) + 1); continue; }
        const l = mapCopart(lot, fetchedAt);
        if (!l) { skipped.set('unvollständig', (skipped.get('unvollständig') ?? 0) + 1); continue; }
        if (l.year < config.copart.minYear) { skipped.set(`vor ${config.copart.minYear}`, (skipped.get(`vor ${config.copart.minYear}`) ?? 0) + 1); continue; }
        if (!seen.has(l.id)) { seen.add(l.id); listings.push(l); }
      }
      if (r.lots.length < config.copart.pageSize) break;
      await sleep(config.copart.delayMs);
    }
    const skipInfo = [...skipped.entries()].map(([k, n]) => `${n}× ${k}`).join(', ');
    return { listings, complete: false, warnings: [`${listings.length} Lose${total != null ? ` von ${total}` : ''} aus ${pages} Seiten übernommen${skipInfo ? ` · übersprungen: ${skipInfo}` : ''}`] };
  }
}
