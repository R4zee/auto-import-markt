import { calcLandedCost } from '../domain/landedCost.js';
import { DESTINATIONS, MARKETS, MARKET_CODES } from '../domain/markets.js';
import type { DecoratedListing, DestCode, Listing, ListingQuery } from '../domain/types.js';
import { calcGermanVehicleTax } from '../domain/vehicleTax.js';
import { listingsRepo } from '../repositories/listings.js';
import { getFacets, invalidateFacets } from './facets.js';
import { eurRate } from './fx.js';
import { attachReferences } from './reference.js';

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
  return { ...l, landed, vehicleTax, reference: null };
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

/** Speicher-Cache der Filterlisten verwerfen (nach lokalem Sync; auf Vercel läuft der Sync extern). */
export function invalidateListingCache(): void {
  invalidateFacets();
}

/**
 * Nur Markt und Angebotsart gesetzt (Startseite, Marktreiter): die Gesamtzahl kommt aus den Marktzählern des
 * Facetten-Caches statt aus einer Zählung über alle aktiven Inserate (bis zum nächsten Sync minimal veraltet, dafür
 * ohne ~280.000 Indexeinträge je Seitenaufruf – auf dem eigenen libsql-Server dauerte die Zählung 45 s).
 */
export function countableFromFacets(q: ListingQuery): boolean {
  return !q.make && !q.model && !q.location && q.yearFrom == null && q.yearTo == null && q.maxKm == null
    && !q.fuels?.length && !q.transmissions?.length && !q.cocOnly && !q.titles?.length && q.maxLandedEur == null && !(q.q ?? '').trim();
}

export async function search(q: ListingQuery): Promise<SearchResult> {
  const dest = q.dest ?? 'DE';
  const fromFacets = countableFromFacets(q);
  const [res, facets] = await Promise.all([listingsRepo.search(q, dest, { countTotal: !fromFacets }), getFacets()]);
  const byOffer = q.offer === 'auction' ? facets.marketCounts.auction : q.offer === 'fixed' ? facets.marketCounts.fixed : facets.marketCounts.all;
  const marketCounts: Record<string, number> = {};
  for (const m of MARKET_CODES) marketCounts[m] = byOffer[m] ?? 0;
  const total = fromFacets
    ? (q.markets?.length ? q.markets : MARKET_CODES).reduce((sum, m) => sum + (byOffer[m] ?? 0), 0)
    : res.total;
  const items = res.items.map((l) => decorate(l, dest));
  // Vergleichspreise DE aus dem Cache (eine Abfrage je Seite; ohne REFERENCE_ENABLED keine)
  await attachReferences(items);
  return {
    items,
    total,
    page: res.page,
    pageSize: res.pageSize,
    marketCounts,
    facets: {
      makes: facets.makes,
      models: q.make ? facets.modelsByMake[q.make] ?? [] : facets.models,
      locations: facets.locations,
    },
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
    sortOptions: ['landed-asc', 'landed-desc', 'year-desc', 'km-asc', 'ending', 'ref-asc', 'ref-desc'],
    fuels: ['Petrol', 'Diesel', 'Hybrid', 'Electric'],
    transmissions: ['Automatic', 'Manual'],
    displayCurrencies: ['EUR', 'USD', 'GBP', 'CHF'],
    languages: ['en', 'de'],
  };
}
