import { one, run } from '../db.js';
import { listingsRepo, type FacetData } from '../repositories/listings.js';

/**
 * Filterlisten (Marken, Modelle, Standorte) und Marktzähler ändern sich nur durch einen Sync. Sie werden
 * deshalb einmal je Sync berechnet, in `meta` abgelegt und je Function-Instanz kurz im Speicher gehalten –
 * statt vier Vollscans über den Bestand bei jeder Suchanfrage.
 */
const META_KEY = 'facets';
const MEMORY_TTL_MS = 5 * 60 * 1000;

let memory: { data: FacetData; loadedAt: number } | null = null;
let pending: Promise<FacetData> | null = null;

export async function refreshFacets(): Promise<FacetData> {
  const data = await listingsRepo.computeFacets();
  await run('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [META_KEY, JSON.stringify(data)]);
  memory = { data, loadedAt: Date.now() };
  return data;
}

async function load(): Promise<FacetData> {
  const row = await one<{ value: string }>('SELECT value FROM meta WHERE key = ?', [META_KEY]);
  if (row) {
    try {
      const data = JSON.parse(row.value) as FacetData;
      if (Array.isArray(data.makes) && data.marketCounts?.all) {
        memory = { data, loadedAt: Date.now() };
        return data;
      }
    } catch { /* neu berechnen */ }
  }
  return refreshFacets();
}

export async function getFacets(): Promise<FacetData> {
  if (memory && Date.now() - memory.loadedAt < MEMORY_TTL_MS) return memory.data;
  if (!pending) pending = load().finally(() => { pending = null; });
  return pending;
}

/** Speicher-Cache verwerfen (Tests, nach lokalem Sync). */
export function invalidateFacets(): void {
  memory = null;
}
