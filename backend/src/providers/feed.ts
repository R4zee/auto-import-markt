import { config, type PartnerFeedConfig } from '../config.js';
import { isMarketCode, marketForCountry } from '../domain/markets.js';
import type { Listing, MarketCode } from '../domain/types.js';
import { defaultPartnerFor } from '../seed/partners.js';
import { getJson } from './http.js';
import { listingId, normalizeDrive, normalizeFuel, normalizeTransmission, type MarketProvider, type ProviderResult } from './types.js';

/**
 * Generischer JSON-Feed-Adapter für Partner-/Exporteur-/Händlerfeeds (USS-Mitglied, JPcenter-API, ein
 * polnischer oder italienischer Händlerbestand, White-Label-Portal …). Die Zuordnung der Feldnamen erfolgt
 * per Mapping (JSON, Punktpfade), z. B.:
 *
 * {"items":"data","id":"lot","market":"JP","country":"jp","year":"year","make":"make",
 *  "model":"model","trim":"grade_label","km":"parsed_mileage","price":"parsed_starting_bid",
 *  "currency":"JPY","offerType":"auction","house":"site","lot":"lot","endsAt":"auction_date",
 *  "grade":"grade_label","photos":"images_hd","url":"detail_url","steering":"steering_wheel"}
 *
 * Werte ohne Punkt und in Großbuchstaben (z. B. "JP", "JPY") gelten als Konstante.
 *
 * Feeds werden in PARTNER_FEEDS (JSON-Array) konfiguriert – ein Eintrag je Partner, jeder wird zu einer eigenen
 * Quelle (`feed-<id>`). Der bisherige Einzel-Feed (JP_FEED_URL/JP_FEED_MAPPING) bleibt als Quelle `jpfeed` erhalten.
 * Fehlt `market` im Feed, wird er aus dem Land abgeleitet (it/es/pt … → SE, pl/cz/ro … → EE).
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

export function mapFeedItem(item: unknown, m: Mapping, source: string, fetchedAt: string, defaults: { market?: MarketCode; country?: string; partnerId?: string } = {}): Listing | null {
  const externalId = String(resolve(item, m, 'id') ?? '');
  const year = num(resolve(item, m, 'year'));
  const make = resolve(item, m, 'make');
  const model = resolve(item, m, 'model');
  const price = num(resolve(item, m, 'price'));
  const country = String(resolve(item, m, 'country') ?? defaults.country ?? '').toLowerCase();
  const marketRaw = resolve(item, m, 'market');
  const market: MarketCode = isMarketCode(marketRaw) ? marketRaw : defaults.market ?? marketForCountry(country) ?? 'JP';
  if (!externalId || !year || !make || !model || !price) return null;

  const steeringRaw = String(resolve(item, m, 'steering') ?? 'left').toLowerCase();
  const steering = steeringRaw.includes('right') || steeringRaw === 'rhd' ? 'RHD' : 'LHD';
  const offerType = String(resolve(item, m, 'offerType') ?? 'fixed').toLowerCase() === 'auction' ? 'auction' : 'fixed';
  const endsRaw = resolve(item, m, 'endsAt');
  const endsAt = endsRaw ? new Date(String(endsRaw)) : null;
  const photosRaw = resolve(item, m, 'photos');
  const photos = Array.isArray(photosRaw) ? photosRaw.map(String) : typeof photosRaw === 'string' && photosRaw ? [photosRaw] : [];
  const ccm = num(resolve(item, m, 'engineCcm'));
  const isEU = market === 'SE' || market === 'EE';

  return {
    id: listingId(source, externalId),
    source,
    externalId,
    market,
    country: country || (market === 'JP' ? 'jp' : market.toLowerCase()),
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
    currency: String(resolve(item, m, 'currency') ?? (isEU ? 'EUR' : 'JPY')),
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
    coc: Boolean(resolve(item, m, 'coc') ?? isEU),
    classic: new Date().getFullYear() - year >= 30,
    dutyRateOverride: null,
    originProof: Boolean(resolve(item, m, 'originProof') ?? false),
    resaleEur: num(resolve(item, m, 'resaleEur')),
    partnerId: String(resolve(item, m, 'partnerId') ?? defaults.partnerId ?? defaultPartnerFor(market)),
    photos,
    photoCount: photos.length,
    damage: [],
    fetchedAt,
    active: true,
  };
}

export class JsonFeedProvider implements MarketProvider {
  readonly id: string;
  readonly label: string;
  private readonly feed: PartnerFeedConfig;

  constructor(feed: PartnerFeedConfig) {
    this.feed = feed;
    this.id = feed.id;
    this.label = feed.label;
  }

  enabled(): boolean {
    return this.feed.url.length > 0 && this.feed.mapping.length > 0;
  }

  async fetchAll(): Promise<ProviderResult> {
    const mapping = JSON.parse(this.feed.mapping) as Mapping;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.feed.authHeader) {
      const [k, ...rest] = this.feed.authHeader.split(':');
      headers[k.trim()] = rest.join(':').trim();
    }
    const json = await getJson<unknown>(this.feed.url, { headers, timeoutMs: 30000 });
    const items = (mapping.items ? get(json, mapping.items) : json) as unknown[];
    if (!Array.isArray(items)) throw new Error(`Feed ${this.id}: items ist kein Array`);
    const fetchedAt = new Date().toISOString();
    const defaults = { market: isMarketCode(this.feed.market) ? this.feed.market : undefined, country: this.feed.country || undefined, partnerId: this.feed.partnerId || undefined };
    const listings = items.map((it) => mapFeedItem(it, mapping, this.id, fetchedAt, defaults)).filter((l): l is Listing => l !== null);
    return { listings, complete: true };
  }
}

/** Alle konfigurierten Feeds als Provider (Legacy-Japan-Feed + PARTNER_FEEDS). */
export function feedProviders(): JsonFeedProvider[] {
  return config.partnerFeeds.map((f) => new JsonFeedProvider(f));
}
