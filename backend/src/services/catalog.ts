import { calcLandedCost } from '../domain/landedCost.js';
import { DESTINATIONS, MARKETS, MARKET_CODES } from '../domain/markets.js';
import type { DecoratedListing, DestCode, Listing, ListingQuery } from '../domain/types.js';
import { calcGermanVehicleTax } from '../domain/vehicleTax.js';
import { listingsRepo } from '../repositories/listings.js';
import { eurRate } from './fx.js';

export function decorate(l: Listing, dest: DestCode): DecoratedListing {
  const landed = calcLandedCost({
    market: l.market,
    price: l.price,
    currency: l.currency,
    classic: l.classic,
    dutyRateOverride: l.dutyRateOverride,
    originProof: l.originProof,
    dest,
    fxRate: eurRate(l.currency),
  });
  const vehicleTax = dest === 'DE'
    ? calcGermanVehicleTax({ fuel: l.fuel, engineCcm: l.engineCcm, co2Gkm: l.co2Gkm, firstRegistration: `${l.year}-07-01` })
    : null;
  return { ...l, landed, vehicleTax };
}

const AUTOMATIC_LIKE = new Set(['Automatic', 'PDK', 'Single speed']);

export interface SearchResult {
  items: DecoratedListing[];
  total: number;
  page: number;
  pageSize: number;
  /** Anzahl je Markt (nur Angebotsart-Filter berücksichtigt, wie im Design) */
  marketCounts: Record<string, number>;
  facets: { makes: string[]; models: string[]; locations: string[] };
}

/** Kurzer Cache des aktiven Bestands – schont die Datenbank bei vielen Filterabfragen. */
let cache: { at: number; items: Listing[] } | null = null;
const CACHE_MS = 30_000;

export async function activeListings(): Promise<Listing[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.items;
  const items = await listingsRepo.allActive();
  cache = { at: Date.now(), items };
  return items;
}

export function invalidateListingCache(): void {
  cache = null;
}

export async function search(q: ListingQuery): Promise<SearchResult> {
  const dest = q.dest ?? 'DE';
  const all = await activeListings();
  const text = (q.q ?? '').trim().toLowerCase();

  const marketCounts: Record<string, number> = {};
  for (const m of MARKET_CODES) {
    marketCounts[m] = all.filter((c) => c.market === m && (!q.offer || q.offer === 'all' || c.offerType === q.offer)).length;
  }

  const uniq = (a: string[]) => Array.from(new Set(a)).sort();
  const facets = {
    makes: uniq(all.map((c) => c.make)),
    models: uniq(all.filter((c) => !q.make || c.make === q.make).map((c) => c.model)),
    locations: uniq(all.map((c) => c.location).filter(Boolean)),
  };

  const list = all.filter((c) => {
    if (q.offer && q.offer !== 'all' && c.offerType !== q.offer) return false;
    if (q.markets?.length && !q.markets.includes(c.market)) return false;
    if (q.make && c.make !== q.make) return false;
    if (q.model && c.model !== q.model) return false;
    if (q.location && c.location !== q.location) return false;
    if (q.yearFrom != null && c.year < q.yearFrom) return false;
    if (q.yearTo != null && c.year > q.yearTo) return false;
    if (q.maxKm != null && c.km > q.maxKm) return false;
    if (q.fuels?.length && !q.fuels.includes(c.fuel)) return false;
    if (q.transmissions?.length) {
      const bucket = AUTOMATIC_LIKE.has(c.transmission) ? 'Automatic' : 'Manual';
      if (!q.transmissions.includes(bucket)) return false;
    }
    if (q.cocOnly && !c.coc) return false;
    if (text) {
      const hay = `${c.make} ${c.model} ${c.trim} ${c.auction?.lot ?? ''} ${c.auction?.house ?? ''} ${c.location}`.toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });

  let decorated = list.map((c) => decorate(c, dest));
  if (q.maxLandedEur != null) decorated = decorated.filter((d) => d.landed.totalEur <= q.maxLandedEur!);

  const ends = (d: DecoratedListing) => (d.auction ? new Date(d.auction.endsAt).getTime() : Number.MAX_SAFE_INTEGER);
  const sort = q.sort ?? 'landed-asc';
  decorated.sort((a, b) => {
    switch (sort) {
      case 'landed-asc': return a.landed.totalEur - b.landed.totalEur;
      case 'landed-desc': return b.landed.totalEur - a.landed.totalEur;
      case 'year-desc': return b.year - a.year;
      case 'km-asc': return a.km - b.km;
      case 'ending': return ends(a) - ends(b);
      default: return 0;
    }
  });

  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 60));
  const items = decorated.slice((page - 1) * pageSize, page * pageSize);
  return { items, total: decorated.length, page, pageSize, marketCounts, facets };
}

export function publicConfig() {
  return {
    markets: MARKET_CODES.map((m) => {
      const meta = MARKETS[m];
      return {
        code: m, flag: meta.flag, isEU: meta.isEU, freightEur: meta.freightEur, dutyRate: meta.dutyRate,
        preferentialDutyRate: meta.preferentialDutyRate, preferentialNote: meta.preferentialNote, deliveryDays: meta.deliveryDays,
      };
    }),
    destinations: Object.values(DESTINATIONS),
    sortOptions: ['landed-asc', 'landed-desc', 'year-desc', 'km-asc', 'ending'],
    fuels: ['Petrol', 'Diesel', 'Hybrid', 'Electric'],
    transmissions: ['Automatic', 'Manual'],
    displayCurrencies: ['EUR', 'USD', 'GBP', 'CHF'],
    languages: ['en', 'de'],
  };
}
