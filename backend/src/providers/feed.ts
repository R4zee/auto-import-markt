import { config } from '../config.ts';
import { isMarketCode } from '../domain/markets.ts';
import type { Listing, MarketCode } from '../domain/types.ts';
import { defaultPartnerFor } from '../seed/partners.ts';
import { listingId, normalizeDrive, normalizeFuel, normalizeTransmission, type MarketProvider, type ProviderResult } from './types.ts';

/**
 * Generischer JSON-Feed-Adapter für Partner-/Exporteur-Feeds (z. B. ein
 * USS-Mitglied, JPcenter-API oder ein White-Label-Portal). Die Zuordnung der
 * Feldnamen erfolgt per Mapping in JP_FEED_MAPPING (JSON, Punktpfade), z. B.:
 *
 * {"items":"data","id":"lot","market":"JP","country":"jp","year":"year","make":"make",
 *  "model":"model","trim":"grade_label","km":"parsed_mileage","price":"parsed_starting_bid",
 *  "currency":"JPY","offerType":"auction","house":"site","lot":"lot","endsAt":"auction_date",
 *  "grade":"grade_label","photos":"images_hd","url":"detail_url","steering":"steering_wheel"}
 *
 * Werte ohne Punkt und in Großbuchstaben (z. B. "JP", "JPY") gelten als Konstante.
 */
type Mapping = Record<string, string>;

function get(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o != null && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function resolve(item: unknown, mapping: Mapping, key: string): unknown {
  const spec = mapping[key];
  if (spec == null) return undefined;
  if (/^[A-Z0-9_]+$/.test(spec) && !(spec in (item as Record<string, unknown>))) return spec; // Konstante
  return get(item, spec);
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export class JsonFeedProvider implements MarketProvider {
  readonly id = 'jpfeed';
  readonly label = 'Partner-Feed Japan';

  enabled(): boolean {
    return config.jpFeed.url.length > 0 && config.jpFeed.mapping.length > 0;
  }

  async fetchAll(): Promise<ProviderResult> {
    const mapping = JSON.parse(config.jpFeed.mapping) as Mapping;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (config.jpFeed.authHeader) {
      const [k, ...rest] = config.jpFeed.authHeader.split(':');
      headers[k.trim()] = rest.join(':').trim();
    }
    const res = await fetch(config.jpFeed.url, { headers, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Feed HTTP ${res.status}`);
    const json = await res.json();
    const items = (mapping.items ? get(json, mapping.items) : json) as unknown[];
    if (!Array.isArray(items)) throw new Error('Feed: items ist kein Array');
    const listings = items.map((it) => this.map(it, mapping)).filter((l): l is Listing => l !== null);
    return { listings, complete: true };
  }

  private map(item: unknown, m: Mapping): Listing | null {
    const externalId = String(resolve(item, m, 'id') ?? '');
    const year = num(resolve(item, m, 'year'));
    const make = resolve(item, m, 'make');
    const model = resolve(item, m, 'model');
    const price = num(resolve(item, m, 'price'));
    const marketRaw = resolve(item, m, 'market');
    const market: MarketCode = isMarketCode(marketRaw) ? marketRaw : 'JP';
    if (!externalId || !year || !make || !model || !price) return null;

    const steeringRaw = String(resolve(item, m, 'steering') ?? 'left').toLowerCase();
    const steering = steeringRaw.includes('right') || steeringRaw === 'rhd' ? 'RHD' : 'LHD';
    const offerType = String(resolve(item, m, 'offerType') ?? 'fixed').toLowerCase() === 'auction' ? 'auction' : 'fixed';
    const endsRaw = resolve(item, m, 'endsAt');
    const endsAt = endsRaw ? new Date(String(endsRaw)) : null;
    const photosRaw = resolve(item, m, 'photos');
    const photos = Array.isArray(photosRaw) ? photosRaw.map(String) : [];
    const ccm = num(resolve(item, m, 'engineCcm'));

    return {
      id: listingId(this.id, externalId),
      source: this.id,
      externalId,
      market,
      country: String(resolve(item, m, 'country') ?? 'jp').toLowerCase(),
      location: String(resolve(item, m, 'location') ?? resolve(item, m, 'house') ?? ''),
      offerType,
      url: (resolve(item, m, 'url') as string | undefined) ?? null,
      year,
      make: String(make),
      model: String(model),
      trim: String(resolve(item, m, 'trim') ?? ''),
      km: num(resolve(item, m, 'km')) ?? 0,
      engine: ccm ? `${(ccm / 1000).toFixed(1)} L` : String(resolve(item, m, 'engine') ?? ''),
      engineCcm: ccm,
      co2Gkm: num(resolve(item, m, 'co2')),
      transmission: normalizeTransmission(String(resolve(item, m, 'transmission') ?? '')),
      drive: normalizeDrive(String(resolve(item, m, 'drive') ?? '')),
      fuel: normalizeFuel(String(resolve(item, m, 'fuel') ?? '')),
      price,
      currency: String(resolve(item, m, 'currency') ?? 'JPY'),
      steering,
      auction: offerType === 'auction' && endsAt && !Number.isNaN(endsAt.getTime())
        ? {
            house: String(resolve(item, m, 'house') ?? ''),
            lot: String(resolve(item, m, 'lot') ?? externalId),
            grade: (resolve(item, m, 'grade') as string | undefined) ?? null,
            gradeNote: null,
            hammerLow: num(resolve(item, m, 'hammerLow')),
            hammerHigh: num(resolve(item, m, 'hammerHigh')),
            endsAt: endsAt.toISOString(),
          }
        : null,
      coc: Boolean(resolve(item, m, 'coc') ?? false),
      classic: new Date().getFullYear() - year >= 30,
      dutyRateOverride: null,
      originProof: Boolean(resolve(item, m, 'originProof') ?? false),
      resaleEur: null,
      partnerId: String(resolve(item, m, 'partnerId') ?? defaultPartnerFor(market)),
      photos,
      photoCount: photos.length,
      damage: [],
      fetchedAt: new Date().toISOString(),
      active: true,
    };
  }
}
