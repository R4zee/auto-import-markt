import type { Listing, Partner, TitleKind } from '../domain/types.js';

/** Optionen für fetchAll: `onBatch` liefert fertige Inserate häppchenweise, damit der Sync sie sofort schreiben kann */
export interface FetchOptions {
  onBatch?: (listings: Listing[]) => Promise<void>;
}

/**
 * Hilfe für Provider, die häppchenweise liefern: sammelt in `listings`, `flush()` reicht alles seit dem letzten Aufruf an
 * `onBatch` weiter (ohne onBatch passiert nichts – die Liste geht wie bisher am Ende zurück).
 */
export function batcher(listings: Listing[], opts?: FetchOptions): { flush: () => Promise<void> } {
  let emitted = 0;
  return {
    async flush() {
      if (!opts?.onBatch || listings.length <= emitted) return;
      const batch = listings.slice(emitted);
      emitted = listings.length;
      await opts.onBatch(batch);
    },
  };
}

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
  /** Bestand laden; Provider mit vielen Seiten reichen Zwischenstände über `opts.onBatch` durch */
  fetchAll(opts?: FetchOptions): Promise<ProviderResult>;
}

/**
 * Fahrzeugbrief-Art aus dem Titeltext nordamerikanischer Auktionen: "CLEAN TITLE" → clean; "SALVAGE TITLE",
 * "CERTIFICATE OF DESTRUCTION", "NON-REPAIRABLE", "JUNK", "PARTS ONLY", "BILL OF SALE" → salvage;
 * "REBUILT", "PRIOR SALVAGE", "RESTORED" → rebuilt; sonstiger Text → other; leer → null.
 */
export function titleKindOf(text: string | null | undefined): TitleKind | null {
  const s = (text ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/rebuilt|prior salvage|restored|reconstructed/.test(s)) return 'rebuilt';
  if (/salvage|destruction|non-?repair|junk|parts only|bill of sale|dismantl|scrap|flood/.test(s)) return 'salvage';
  if (/clean|clear/.test(s)) return 'clean';
  return 'other';
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
