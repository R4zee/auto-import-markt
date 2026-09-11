import type { Listing } from '../domain/types.js';

/**
 * Referenzpreise vergleichbarer Angebote im Zielmarkt (z. B. mobile.de) für die Detailansicht.
 * Die Datenquelle wird als eigener Provider angebunden (Registry unten); ohne registrierte
 * Quelle antwortet /api/listings/:id/reference mit 204 und das Frontend blendet die Karte aus.
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

export interface ReferenceProvider {
  readonly id: string;
  enabled(): boolean;
  lookup(listing: Pick<Listing, 'make' | 'model' | 'year'>): Promise<ReferencePrices | null>;
}

const providers: ReferenceProvider[] = [];

export function registerReferenceProvider(p: ReferenceProvider): void {
  providers.push(p);
}

export function referenceEnabled(): boolean {
  return providers.some((p) => p.enabled());
}

const cache = new Map<string, { at: number; value: ReferencePrices | null }>();
const TTL_MS = 60 * 60 * 1000;

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export async function referencePrices(listing: Pick<Listing, 'make' | 'model' | 'year'>): Promise<ReferencePrices | null> {
  const provider = providers.find((p) => p.enabled());
  if (!provider) return null;
  const key = `${provider.id}|${listing.make}|${listing.model}|${listing.year}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: ReferencePrices | null = null;
  try { value = await provider.lookup(listing); } catch { value = null; }
  cache.set(key, { at: Date.now(), value });
  return value;
}
