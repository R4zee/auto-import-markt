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

export interface SearchResult {
  items: DecoratedListing[];
  total: number;
  page: number;
  pageSize: number;
  /** Anzahl je Markt (nur Angebotsart-Filter berücksichtigt, wie im Design) */
  marketCounts: Record<string, number>;
  facets: { makes: string[]; models: string[]; locations: string[] };
}

/** Kein Bestands-Cache mehr nötig – Filter/Sortierung laufen in SQL. Bleibt als No-op für Aufrufer. */
export function invalidateListingCache(): void {
  /* SQL-basierte Suche, nichts zu invalidieren */
}

export async function search(q: ListingQuery): Promise<SearchResult> {
  const dest = q.dest ?? 'DE';
  const res = await listingsRepo.search(q, dest);
  const marketCounts: Record<string, number> = {};
  for (const m of MARKET_CODES) marketCounts[m] = res.marketCounts[m] ?? 0;
  return {
    items: res.items.map((l) => decorate(l, dest)),
    total: res.total,
    page: res.page,
    pageSize: res.pageSize,
    marketCounts,
    facets: res.facets,
  };
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
