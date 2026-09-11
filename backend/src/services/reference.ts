import { config } from '../config.ts';
import type { Listing } from '../domain/types.ts';
import { carapisPrice, pick } from '../providers/carapis.ts';
import { num } from '../providers/http.ts';
import { carapisEnabled, fetchVehicles } from './carapisClient.ts';
import { eurRate, getFx } from './fx.ts';

/**
 * Referenzpreise im Zielmarkt (mobile.de über Carapis): vergleichbare Angebote
 * gleicher Marke/Modell mit Baujahr ±1, umgerechnet in EUR.
 */
export interface ReferencePrices {
  source: string;
  count: number;
  minEur: number | null;
  medianEur: number | null;
  maxEur: number | null;
  medianKm: number | null;
  yearFrom: number;
  yearTo: number;
  samples: Array<{ priceEur: number; year: number; km: number; url: string | null }>;
  fetchedAt: string;
}

const cache = new Map<string, { at: number; value: ReferencePrices | null }>();
const TTL_MS = 60 * 60 * 1000;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function referenceEnabled(): boolean {
  return carapisEnabled() && config.carapis.referenceSource.length > 0;
}

export async function referencePrices(listing: Pick<Listing, 'make' | 'model' | 'year'>): Promise<ReferencePrices | null> {
  if (!referenceEnabled()) return null;
  const yearFrom = listing.year - 1;
  const yearTo = listing.year + 1;
  const key = `${listing.make}|${listing.model}|${yearFrom}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  let value: ReferencePrices | null = null;
  try {
    await getFx();
    const res = await fetchVehicles({
      source: config.carapis.referenceSource,
      brand: listing.make,
      model: listing.model,
      min_year: yearFrom,
      max_year: yearTo,
      is_new_vehicle: false,
      available_only: true,
      page_size: 50,
    });
    const samples: ReferencePrices['samples'] = [];
    for (const v of res.results) {
      const priced = carapisPrice(v, 'EUR');
      const year = num(pick(v, 'year', 'manufacturing_year'));
      if (!priced || !year) continue;
      let rate = 1;
      try { rate = eurRate(priced.currency); } catch { continue; }
      samples.push({
        priceEur: Math.round(priced.price * rate),
        year,
        km: Math.round(num(pick(v, 'mileage', 'mileage_km', 'odometer')) ?? 0),
        url: (pick(v, 'url', 'source_url', 'listing_url') as string | undefined) ?? null,
      });
    }
    const prices = samples.map((s) => s.priceEur);
    value = {
      source: config.carapis.referenceSource,
      count: res.count || samples.length,
      minEur: prices.length ? Math.min(...prices) : null,
      medianEur: median(prices),
      maxEur: prices.length ? Math.max(...prices) : null,
      medianKm: median(samples.map((s) => s.km).filter((k) => k > 0)),
      yearFrom,
      yearTo,
      samples: samples.slice(0, 10),
      fetchedAt: new Date().toISOString(),
    };
    if (!samples.length) value = { ...value, count: 0 };
  } catch {
    value = null;
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}
