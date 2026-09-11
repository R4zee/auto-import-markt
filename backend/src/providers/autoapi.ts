import { config } from '../config.ts';
import type { Listing } from '../domain/types.ts';
import { defaultPartnerFor } from '../seed/partners.ts';
import { getJson, num, sleep, str } from './http.ts';
import { listingId, normalizeDrive, normalizeFuel, normalizeTransmission, type MarketProvider, type ProviderResult } from './types.ts';

/**
 * auto-api.com – lizenzierter Datenfeed für Dubizzle Motors und Dubicars (VAE).
 * Doku: https://auto-api.com/documentation
 * Base: https://{access_name}.auto-api.com/api/v2/{dubizzle|dubicars}
 * Auth: ?api_key=…  Endpunkte: /offers?page=N, /offer?inner_id=…, /changes?change_id=…
 * Zugang/Preise nur auf Anfrage (access@auto-api.com).
 */
export interface AutoApiOffer {
  id?: number | string; inner_id?: string; url?: string; mark?: string; model?: string; configuration?: string; complectation?: string;
  year?: number | string; color?: string; price?: number | string; km_age?: number | string; engine_type?: string; transmission_type?: string;
  body_type?: string; address?: string; seller_type?: string; is_dealer?: boolean; seller?: string; description?: string;
  displacement?: number | string; offer_created?: string; images?: string[]; extra?: Record<string, unknown>;
}

export function mapAutoApi(o: AutoApiOffer, source: 'dubizzle' | 'dubicars', fetchedAt: string): Listing | null {
  const externalId = str(o.inner_id || o.id);
  const year = num(o.year);
  const price = num(o.price);
  if (!externalId || !year || !price || !o.mark || !o.model) return null;
  const extra = o.extra ?? {};
  const steeringRaw = str(extra.steering ?? extra.steering_side ?? '').toLowerCase();
  const steering = steeringRaw.includes('right') ? 'RHD' : 'LHD';
  const disp = num(o.displacement);
  const ccm = disp ? (disp < 20 ? Math.round(disp * 1000) : Math.round(disp)) : null;
  const specs = str(extra.regional_specs ?? extra.specs ?? '');
  const photos = (o.images ?? []).filter(Boolean);
  const fuel = normalizeFuel(o.engine_type);

  return {
    id: listingId(`autoapi-${source}`, externalId),
    source: `autoapi-${source}`,
    externalId,
    market: 'GCC',
    country: 'ae',
    location: str(o.address).split(',')[0]?.trim() || 'Dubai',
    offerType: 'fixed',
    url: o.url ?? null,
    year,
    make: o.mark,
    model: o.model,
    trim: [o.configuration, o.complectation, specs ? `${specs} spec` : null].filter(Boolean).join(' · '),
    km: Math.round(num(o.km_age) ?? 0),
    engine: fuel === 'Electric' ? 'EV' : ccm ? `${(ccm / 1000).toFixed(1)} L` : '',
    engineCcm: ccm,
    co2Gkm: null,
    transmission: normalizeTransmission(o.transmission_type),
    drive: normalizeDrive(str(extra.drive_type ?? extra.drivetrain ?? '')),
    fuel,
    price,
    currency: 'AED',
    steering,
    auction: null,
    coc: false,
    classic: new Date().getFullYear() - year >= 30,
    dutyRateOverride: null,
    originProof: false,
    resaleEur: null,
    partnerId: defaultPartnerFor('GCC'),
    photos,
    photoCount: photos.length,
    damage: [],
    fetchedAt,
    active: true,
  };
}

export class AutoApiProvider implements MarketProvider {
  readonly id = 'autoapi';
  readonly label = 'auto-api.com – Dubizzle/Dubicars (VAE)';

  enabled(): boolean {
    return config.autoapi.accessName.length > 0 && config.autoapi.apiKey.length > 0;
  }

  async fetchAll(): Promise<ProviderResult> {
    const fetchedAt = new Date().toISOString();
    const listings: Listing[] = [];
    for (const source of config.autoapi.sources) {
      for (let page = 1; page <= config.autoapi.pages; page++) {
        const url = `https://${config.autoapi.accessName}.auto-api.com/api/v2/${source}/offers?page=${page}&api_key=${encodeURIComponent(config.autoapi.apiKey)}`;
        const json = await getJson<{ meta?: { page?: number; next_page?: number | null }; data?: AutoApiOffer[]; offers?: AutoApiOffer[] }>(url);
        const offers = json.data ?? json.offers ?? [];
        for (const o of offers) {
          const mapped = mapAutoApi(o, source, fetchedAt);
          if (mapped) listings.push(mapped);
        }
        if (!json.meta?.next_page || offers.length === 0) break;
        await sleep(300);
      }
    }
    return { listings, complete: false };
  }
}
