export type MarketCode = 'JP' | 'KR' | 'US' | 'GCC' | 'SE' | 'EE';
export type DestCode = 'DE' | 'AT' | 'NL' | 'PL';
export type OfferType = 'auction' | 'fixed';
export type Fuel = 'Petrol' | 'Diesel' | 'Hybrid' | 'Electric';
export type SortKey = 'landed-asc' | 'landed-desc' | 'year-desc' | 'km-asc' | 'ending';

export interface CostLine { key: string; vars?: Record<string, string | number>; amountEur: number | null }

export interface LandedCost {
  dest: DestCode; fxRate: number; fobEur: number; freightEur: number; insuranceEur: number; cifEur: number;
  dutyRate: number; dutyEur: number; vatRate: number; vatEur: number; clearingEur: number; inspectionEur: number;
  registrationEur: number; partnerFeeEur: number; totalEur: number; lines: CostLine[]; noteKey: string;
  noteVars: Record<string, string | number>; isEU: boolean;
}

export interface Listing {
  id: string; source: string; externalId: string; market: MarketCode; country: string; location: string;
  offerType: OfferType; url: string | null; year: number; make: string; model: string; trim: string; km: number;
  engine: string; engineCcm: number | null; co2Gkm: number | null; transmission: string; drive: string; fuel: Fuel;
  price: number; currency: string; steering: 'LHD' | 'RHD';
  auction: { house: string; lot: string; grade: string | null; gradeNote: string | null; hammerLow: number | null; hammerHigh: number | null; endsAt: string } | null;
  coc: boolean; classic: boolean; dutyRateOverride: number | null; originProof: boolean; resaleEur: number | null;
  partnerId: string; photos: string[]; photoCount: number; damage: Array<{ panel: string; code: string }>;
  fetchedAt: string; active: boolean;
  landed: LandedCost;
  vehicleTax: { annualEur: number; method: string; estimated: boolean } | null;
}

export interface ReferencePrices {
  source: string; count: number; minEur: number | null; medianEur: number | null; maxEur: number | null; medianKm: number | null;
  yearFrom: number; yearTo: number; samples: Array<{ priceEur: number; year: number; km: number; url: string | null }>; fetchedAt: string;
}

export interface Partner { id: string; name: string; note: string; markets: MarketCode[]; email: string | null }

export interface SearchResult {
  items: Listing[]; total: number; page: number; pageSize: number;
  marketCounts: Record<MarketCode, number>;
  facets: { makes: string[]; models: string[]; locations: string[] };
}

export interface AppConfig {
  markets: Array<{ code: MarketCode; flag: string; isEU: boolean; freightEur: number; dutyRate: number; preferentialDutyRate: number | null; preferentialNote: string | null; deliveryDays: [number, number] }>;
  destinations: Array<{ code: DestCode; flag: string; vatRate: number; classicVatRate: number; port: string; taxLabel: string }>;
  fx: { rates: Record<string, number>; asOf: string; source: string };
}

export interface SearchParams {
  q?: string; offer?: 'all' | OfferType; markets?: MarketCode[]; make?: string; model?: string; location?: string;
  yearFrom?: number; yearTo?: number; maxKm?: number; fuels?: Fuel[]; transmissions?: Array<'Automatic' | 'Manual'>;
  cocOnly?: boolean; maxLanded?: number; dest: DestCode; sort?: SortKey;
}

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  config: () => http<AppConfig>('/api/config'),

  search(p: SearchParams): Promise<SearchResult> {
    const sp = new URLSearchParams();
    const set = (k: string, v: unknown) => { if (v !== undefined && v !== '' && v !== null && !(Array.isArray(v) && !v.length)) sp.set(k, Array.isArray(v) ? v.join(',') : String(v)); };
    set('q', p.q); set('offer', p.offer); set('markets', p.markets); set('make', p.make); set('model', p.model); set('location', p.location);
    set('yearFrom', p.yearFrom); set('yearTo', p.yearTo); set('maxKm', p.maxKm); set('fuels', p.fuels); set('transmissions', p.transmissions);
    set('cocOnly', p.cocOnly ? 'true' : undefined); set('maxLanded', p.maxLanded); set('dest', p.dest); set('sort', p.sort);
    sp.set('pageSize', '200');
    return http<SearchResult>(`/api/listings?${sp}`);
  },

  listing: (id: string, dest: DestCode) => http<{ listing: Listing; partner: Partner | null; referenceAvailable?: boolean }>(`/api/listings/${encodeURIComponent(id)}?dest=${dest}`),

  async reference(id: string): Promise<ReferencePrices | null> {
    const res = await fetch(`${BASE}/api/listings/${encodeURIComponent(id)}/reference`);
    if (res.status === 204 || !res.ok) return null;
    return (await res.json()) as ReferencePrices;
  },

  batch: (ids: string[], dest: DestCode) =>
    ids.length ? http<{ items: Listing[]; partners: Record<string, Partner> }>(`/api/listings/batch?ids=${encodeURIComponent(ids.join(','))}&dest=${dest}`)
      : Promise.resolve({ items: [], partners: {} }),

  enquiry: (body: { listingId: string; dest: DestCode; lang: string; name: string; email: string; phone: string; message: string; optInspection: boolean; optBid: boolean }) =>
    http<{ id: string; partner: { id: string; name: string } | null }>('/api/enquiries', { method: 'POST', body: JSON.stringify(body) }),

  bulkEnquiry: (body: { listingIds: string[]; dest: DestCode; lang: string; name: string; email: string; phone: string; message: string; optInspection: boolean; optBid: boolean }) =>
    http<{ enquiries: Array<{ id: string; partnerId: string; count: number }>; total: number }>('/api/enquiries/bulk', { method: 'POST', body: JSON.stringify(body) }),
};
