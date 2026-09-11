import { config } from '../config.js';
import { getJson } from '../providers/http.js';

/**
 * Dünner Client für das Carapis Catalog API (v1.0.0).
 *   Base:  https://api.carapis.com
 *   Auth:  X-API-Key: car_…   (alternativ Authorization: Bearer car_…)
 *   GET /apix/catalog_api/vehicles/?source=&brand=&model=&min_year=&max_year=&page=&page_size=
 *   GET /apix/catalog_api/sources/   GET /apix/catalog_api/brands/   GET /apix/catalog_api/models/?brand=
 * Antworten sind DRF-paginiert: { count, next, previous, results[] }.
 */
export interface CarapisPage<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export type CarapisVehicle = Record<string, unknown>;

export interface CarapisSource {
  code?: string; slug?: string; name?: string; region?: string; country?: string;
  availability?: 'live' | 'on_demand' | string; last_parsed_at?: string | null; [k: string]: unknown;
}

export interface VehicleQuery {
  source: string;
  brand?: string;
  model?: string;
  min_year?: number;
  max_year?: number;
  min_price?: number;
  max_price?: number;
  max_mileage?: number;
  fuel_type?: string;
  available_only?: boolean;
  is_new_vehicle?: boolean;
  ordering?: string;
  page?: number;
  page_size?: number;
  search?: string;
}

export function carapisEnabled(): boolean {
  return config.carapis.apiKey.length > 0;
}

function headers(): Record<string, string> {
  return { 'X-API-Key': config.carapis.apiKey, Accept: 'application/json' };
}

function normalizePage<T>(json: unknown): CarapisPage<T> {
  if (Array.isArray(json)) return { count: json.length, next: null, previous: null, results: json as T[] };
  const o = (json ?? {}) as Record<string, unknown>;
  const results = (o.results ?? o.data ?? o.items ?? []) as T[];
  return {
    count: typeof o.count === 'number' ? o.count : results.length,
    next: (o.next as string | null) ?? null,
    previous: (o.previous as string | null) ?? null,
    results,
  };
}

export async function fetchVehicles(q: VehicleQuery): Promise<CarapisPage<CarapisVehicle>> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  if (!params.has('available_only')) params.set('available_only', 'true');
  const json = await getJson<unknown>(`${config.carapis.baseUrl}/apix/catalog_api/vehicles/?${params}`, { headers: headers(), timeoutMs: 30000 });
  return normalizePage<CarapisVehicle>(json);
}

export async function fetchVehicle(id: string): Promise<CarapisVehicle> {
  return getJson<CarapisVehicle>(`${config.carapis.baseUrl}/apix/catalog_api/vehicles/${encodeURIComponent(id)}/`, { headers: headers() });
}

export async function fetchSources(): Promise<CarapisSource[]> {
  const json = await getJson<unknown>(`${config.carapis.baseUrl}/apix/catalog_api/sources/`, { headers: headers() });
  return normalizePage<CarapisSource>(json).results;
}

export async function fetchBrands(search?: string): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({ limit: '200' });
  if (search) params.set('search', search);
  const json = await getJson<unknown>(`${config.carapis.baseUrl}/apix/catalog_api/brands/?${params}`, { headers: headers() });
  return normalizePage<Record<string, unknown>>(json).results;
}
