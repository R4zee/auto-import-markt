import { config } from '../config.ts';
import type { Listing } from '../domain/types.ts';
import { defaultPartnerFor } from '../seed/partners.ts';
import { getJson, num, sleep, str } from './http.ts';
import { listingId, milesToKm, normalizeDrive, normalizeFuel, normalizeTransmission, type MarketProvider, type ProviderResult } from './types.ts';

/**
 * Apibara – Vehicle Auction Data API (Copart + IAAI, USA).
 * Doku: https://apibara.tech/en/products/vehicle-auction-data-api/docs
 * Auth: Header X-API-Key. Test-Plan: 100 Requests/Monat, per_page 20, Cursor-Paginierung.
 * Die Feldstruktur weicht zwischen OpenAPI-Schema (flach) und Doku-Beispiel (verschachtelt)
 * ab; das Mapping liest beides.
 */
export interface ApibaraVehicle {
  platform?: string; lot_number?: string | number; vin?: string; title?: string; year?: number; make?: string; model?: string;
  trim?: string; url?: string;
  auction?: { state?: string; auction_at?: string | null; lot_status?: string; lot_sub_status?: string };
  pricing?: { current_bid_usd?: number | null; buy_now_usd?: number | null; sale_price_usd?: number | null };
  current_bid?: number | null; buy_now_price?: number | null;
  location?: { display?: string; state?: string; facility_id?: string };
  condition?: { primary_damage?: string; secondary_damage?: string; has_key?: boolean; run_condition?: string };
  odometer?: { mi?: number; km?: number } | number;
  vehicle_specs?: { exterior_color?: string; engine?: string; transmission?: string; fuel_type?: string; drive_type?: string; cylinders?: number };
  damage?: string; fuel_type?: string; transmission?: string; drive_type?: string; run_cond?: string; engine_size?: number; cylinders?: number;
  media?: { photos?: string[]; thumbs?: string[] };
  sale_document?: { name?: string; type?: string };
}

export function mapApibara(v: ApibaraVehicle, fetchedAt: string): Listing | null {
  const lot = str(v.lot_number);
  const year = num(v.year);
  if (!lot || !year || !v.make || !v.model) return null;
  const bid = v.pricing?.current_bid_usd ?? v.current_bid ?? null;
  const buyNow = v.pricing?.buy_now_usd ?? v.buy_now_price ?? null;
  const price = (bid && bid > 0 ? bid : buyNow) ?? null;
  if (!price || price <= 0) return null;
  if ((v.auction?.lot_sub_status ?? '').toLowerCase() === 'ended') return null;

  const endsAt = v.auction?.auction_at ? new Date(v.auction.auction_at) : null;
  const isAuction = !!endsAt && !Number.isNaN(endsAt.getTime()) && endsAt.getTime() > Date.now();
  const odo = typeof v.odometer === 'number' ? { mi: v.odometer } : v.odometer ?? {};
  const km = odo.km ?? (odo.mi != null ? milesToKm(odo.mi) : 0);
  const platform = (v.platform ?? '').toLowerCase() === 'iaai' ? 'IAAI' : 'Copart';
  const damage = v.condition?.primary_damage ?? v.damage ?? '';
  const runCond = v.condition?.run_condition ?? v.run_cond ?? '';
  const specs = v.vehicle_specs ?? {};
  const photos = v.media?.photos?.length ? v.media.photos : v.media?.thumbs ?? [];
  const engine = specs.engine ?? (v.engine_size ? `${v.engine_size.toFixed(1)} L${v.cylinders ? ` ${v.cylinders}-cyl` : ''}` : '');
  const docType = v.sale_document?.type ?? v.sale_document?.name ?? '';

  return {
    id: listingId('apibara', `${platform.toLowerCase()}-${lot}`),
    source: 'apibara',
    externalId: `${platform.toLowerCase()}-${lot}`,
    market: 'US',
    country: 'us',
    location: str(v.location?.display ?? v.location?.state),
    offerType: isAuction ? 'auction' : 'fixed',
    url: v.url ?? (platform === 'IAAI' ? `https://www.iaai.com/VehicleDetail/${lot}` : `https://www.copart.com/lot/${lot}`),
    year,
    make: v.make,
    model: v.model,
    trim: [v.trim, docType ? `Title: ${docType}` : null].filter(Boolean).join(' · ') || str(v.title),
    km: Math.round(km),
    engine,
    engineCcm: v.engine_size ? Math.round(v.engine_size * 1000) : null,
    co2Gkm: null,
    transmission: normalizeTransmission(specs.transmission ?? v.transmission),
    drive: normalizeDrive(specs.drive_type ?? v.drive_type),
    fuel: normalizeFuel(specs.fuel_type ?? v.fuel_type),
    price,
    currency: 'USD',
    steering: 'LHD',
    auction: isAuction
      ? {
          house: `${platform} ${str(v.location?.display ?? '')}`.trim(),
          lot,
          grade: runCond || null,
          gradeNote: [damage ? `Primary damage: ${damage}` : null, v.condition?.secondary_damage ? `Secondary: ${v.condition.secondary_damage}` : null, v.condition?.has_key != null ? (v.condition.has_key ? 'Keys present' : 'No keys') : null].filter(Boolean).join('. ') || null,
          hammerLow: null,
          hammerHigh: buyNow ?? null,
          endsAt: endsAt!.toISOString(),
        }
      : null,
    coc: false,
    classic: new Date().getFullYear() - year >= 30,
    dutyRateOverride: null,
    originProof: false,
    resaleEur: null,
    partnerId: defaultPartnerFor('US'),
    photos,
    photoCount: photos.length,
    damage: [],
    fetchedAt,
    active: true,
  };
}

export class ApibaraProvider implements MarketProvider {
  readonly id = 'apibara';
  readonly label = 'Apibara – Copart/IAAI (USA)';

  enabled(): boolean {
    return config.apibara.apiKey.length > 0;
  }

  async fetchAll(): Promise<ProviderResult> {
    const fetchedAt = new Date().toISOString();
    const listings: Listing[] = [];
    for (const platform of config.apibara.platforms) {
      let cursor: string | null = null;
      for (let page = 0; page < config.apibara.pages; page++) {
        const params = new URLSearchParams({ platform, per_page: '20', lot_sub_status: 'Open', units: 'km' });
        if (config.apibara.make) params.set('make', config.apibara.make);
        if (cursor) params.set('cursor', cursor);
        const json: { ok: boolean; data: ApibaraVehicle[]; meta?: { next_cursor?: string | null } } = await getJson(
          `https://apibara.tech/api/v1/vehicle-auction/vehicles?${params}`,
          { headers: { 'X-API-Key': config.apibara.apiKey, Accept: 'application/json' } },
        );
        for (const v of json.data ?? []) {
          const mapped = mapApibara(v, fetchedAt);
          if (mapped) listings.push(mapped);
        }
        cursor = json.meta?.next_cursor ?? null;
        if (!cursor) break;
        await sleep(400);
      }
    }
    // Nur ein Ausschnitt des Bestands → alte Lots nicht deaktivieren (Auktionen laufen ohnehin aus)
    return { listings, complete: false };
  }
}
