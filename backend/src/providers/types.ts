import type { Listing, Partner } from '../domain/types.js';

export interface ProviderResult {
  listings: Listing[];
  /** Partner, die der Provider mitliefert (werden vor den Listings gespeichert) */
  partners?: Partner[];
  /**
   * true, wenn das Ergebnis den vollständigen aktiven Bestand der Quelle darstellt.
   * Dann werden fehlende Listings dieser Quelle deaktiviert.
   */
  complete: boolean;
  /** Nicht-fatale Probleme (z. B. gedrosselte Teilquellen) – landen im Sync-Protokoll */
  warnings?: string[];
}

export interface MarketProvider {
  /** Eindeutiger Quellen-Schlüssel, Präfix der Listing-IDs */
  readonly id: string;
  readonly label: string;
  /** Ob der Provider konfiguriert ist (Keys, URL …) */
  enabled(): boolean;
  fetchAll(): Promise<ProviderResult>;
}

export function listingId(source: string, externalId: string): string {
  return `${source}:${externalId}`;
}

/**
 * Motorleistung in kW aus Anzeigetexten: "140 kW (190 PS)", "190 KM" (polnisch PS), "224 CP" (rumänisch), "150 cv",
 * "к.с." (bulgarisch). Reine Zahl ohne Einheit gilt als PS (so führen OLX, Subito, Sauto die Leistung überwiegend).
 */
export function powerKwFromText(text: string | number | null | undefined): number | null {
  if (text == null || text === '') return null;
  const s = String(text).replace(/ /g, ' ');
  const kw = s.match(/(\d{2,4})\s*kw/i);
  if (kw) return Number(kw[1]);
  const ps = s.match(/(\d{2,4})\s*(ps|hp|km|cp|cv|к\.?\s?с\.?|bhp)/i) ?? (/^\s*\d{2,4}\s*$/.test(s) ? [s, s.trim()] : null);
  if (!ps) return null;
  const n = Number(ps[1]);
  if (!Number.isFinite(n) || n < 30 || n > 1500) return null;
  return Math.round(n * 0.7355);
}

/** Hilfsfunktion: Meilen → km */
export function milesToKm(miles: number): number {
  return Math.round(miles * 1.609344);
}

export function normalizeFuel(v: string | null | undefined): Listing['fuel'] {
  const s = (v ?? '').toLowerCase();
  if (s.includes('electric') || s === 'ev' || s.includes('elektro')) return 'Electric';
  if (s.includes('hybrid') || s.includes('plug')) return 'Hybrid';
  if (s.includes('diesel')) return 'Diesel';
  return 'Petrol';
}

export function normalizeTransmission(v: string | null | undefined): Listing['transmission'] {
  const s = (v ?? '').toLowerCase();
  if (s.includes('manual') || s.includes('schalt') || s === 'mt') return 'Manual';
  if (s.includes('pdk')) return 'PDK';
  if (s.includes('single') || s.includes('direct drive') || s.includes('reduction')) return 'Single speed';
  return 'Automatic';
}

export function normalizeDrive(v: string | null | undefined): Listing['drive'] {
  const s = (v ?? '').toLowerCase();
  if (s.includes('4wd') || s.includes('4x4')) return '4WD';
  if (s.includes('awd') || s.includes('all')) return 'AWD';
  if (s.includes('fwd') || s.includes('front')) return 'FWD';
  return 'RWD';
}
