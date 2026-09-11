import { config } from '../config.js';
import type { Listing } from '../domain/types.js';
import { defaultPartnerFor } from '../seed/partners.js';
import { getJson, num, sleep, str } from './http.js';
import { listingId, normalizeDrive, normalizeFuel, normalizeTransmission, type MarketProvider, type ProviderResult } from './types.js';

/**
 * xapikorea.com – kommerzieller Wrapper um Encar mit englischen Feldern (Fallback, falls der
 * Direktzugriff auf api.encar.com blockiert wird). OpenAPI: https://api.xapikorea.com/openapi.json
 *   Auth:   X-API-Key
 *   Suche:  GET /v1/search?page=&limit=(1-50)&brand=&year_from=&price_min=&sort=ModifiedDate&lang=en
 *           → { total_count, page, limit, next_page, results[] }
 *   Detail: GET /v1/cars/{id} → engine_cc, drive_type, photos[], vin, had_accident …
 * Tarife: Free 500 Req/Monat (5 rpm), Starter 20 €/Monat (10k), Pro 40 €/Monat (100k).
 */
export interface XapiSearchItem {
  id: string | number; manufacturer?: string; model?: string; badge?: string; badge_detail?: string; year?: number | string;
  mileage_km?: number; price_krw?: number; price_eur?: number; fuel_type?: string; transmission?: string; location?: string;
  thumbnail?: string; encar_url?: string;
}

export interface XapiDetail extends XapiSearchItem {
  form_year?: number | string; engine_cc?: number; drive_type?: string; photos?: string[]; vin?: string; had_accident?: boolean;
  accident_count?: number; owner_change_count?: number; inspection_grade?: string; body_style?: string; color?: string;
}

export function mapXapi(item: XapiSearchItem, detail: XapiDetail | null, fetchedAt: string): Listing | null {
  const id = str(item.id);
  const year = num(detail?.form_year ?? item.year);
  const price = num(item.price_krw);
  const make = str(item.manufacturer);
  const model = str(item.model);
  if (!id || !year || !price || !make || !model) return null;
  const fuel = normalizeFuel(item.fuel_type);
  const ccm = fuel === 'Electric' ? null : num(detail?.engine_cc);
  const photos = (detail?.photos?.length ? detail.photos : item.thumbnail ? [item.thumbnail] : []).filter((u) => /^https?:\/\//.test(u));
  const trim = [item.badge, item.badge_detail].map((s) => (s ?? '').trim()).filter(Boolean).join(' · ');
  return {
    id: listingId('xapikorea', id),
    source: 'xapikorea',
    externalId: id,
    market: 'KR',
    country: 'kr',
    location: str(item.location),
    offerType: 'fixed',
    url: item.encar_url ?? null,
    year,
    make,
    model,
    trim,
    km: Math.round(num(item.mileage_km) ?? 0),
    engine: fuel === 'Electric' ? 'EV' : ccm ? `${(ccm / 1000).toFixed(1)} L` : trim.match(/\d\.\d/)?.[0] ?? '',
    engineCcm: ccm,
    co2Gkm: null,
    transmission: normalizeTransmission(item.transmission),
    drive: normalizeDrive(detail?.drive_type),
    fuel,
    price,
    currency: 'KRW',
    steering: 'LHD',
    auction: null,
    coc: false,
    classic: new Date().getFullYear() - year >= 30,
    dutyRateOverride: null,
    originProof: false,
    resaleEur: null,
    partnerId: defaultPartnerFor('KR'),
    photos,
    photoCount: photos.length,
    damage: [],
    fetchedAt,
    active: true,
  };
}

export class XapiKoreaProvider implements MarketProvider {
  readonly id = 'xapikorea';
  readonly label = 'xapikorea.com (Encar-Wrapper, Fallback)';

  enabled(): boolean {
    return config.xapikorea.apiKey.length > 0;
  }

  private headers(): Record<string, string> {
    return { 'X-API-Key': config.xapikorea.apiKey, Accept: 'application/json' };
  }

  async fetchAll(): Promise<ProviderResult> {
    const fetchedAt = new Date().toISOString();
    const listings: Listing[] = [];
    const brands = config.xapikorea.brands.length ? config.xapikorea.brands : [undefined];
    for (const brand of brands) {
      for (let page = 1; page <= config.xapikorea.pages; page++) {
        const params = new URLSearchParams({ page: String(page), limit: '50', sort: 'ModifiedDate', lang: 'en' });
        if (brand) params.set('brand', brand);
        if (config.xapikorea.minPriceKrw > 0) params.set('price_min', String(config.xapikorea.minPriceKrw));
        const res = await getJson<{ total_count: number; next_page: number | null; results: XapiSearchItem[] }>(
          `https://api.xapikorea.com/v1/search?${params}`, { headers: this.headers() },
        );
        for (const item of res.results ?? []) {
          let detail: XapiDetail | null = null;
          if (config.xapikorea.fetchDetails) {
            try { detail = await getJson<XapiDetail>(`https://api.xapikorea.com/v1/cars/${encodeURIComponent(str(item.id))}`, { headers: this.headers(), retries: 1 }); } catch { /* ohne Detail */ }
            await sleep(config.xapikorea.delayMs);
          }
          const mapped = mapXapi(item, detail, fetchedAt);
          if (mapped) listings.push(mapped);
        }
        if (!res.next_page) break;
        await sleep(config.xapikorea.delayMs);
      }
    }
    return { listings, complete: true };
  }
}
