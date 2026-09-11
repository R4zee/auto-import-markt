import type { DestCode, MarketCode } from './types.ts';

export interface MarketMeta {
  code: MarketCode;
  /** Flaggen-Code des repräsentativen Landes */
  flag: string;
  isEU: boolean;
  /** Pauschale Seefracht / Transport bis Zielhafen (EUR) */
  freightEur: number;
  /** Regelzollsatz Pkw (HS 8703) */
  dutyRate: number;
  /** Präferenzzollsatz bei Ursprungsnachweis (Freihandelsabkommen) */
  preferentialDutyRate: number | null;
  /** Kurzbegründung des Präferenzsatzes */
  preferentialNote: string | null;
  /** Typische Lieferzeit ab Kauf (Tage) */
  deliveryDays: [number, number];
  currencies: string[];
}

export const MARKETS: Record<MarketCode, MarketMeta> = {
  JP: {
    code: 'JP', flag: 'jp', isEU: false, freightEur: 1850, dutyRate: 0.10,
    preferentialDutyRate: 0,
    preferentialNote: 'EU-Japan EPA: Pkw-Zoll seit Feb. 2026 bei 0 % – nur mit gültiger Ursprungserklärung.',
    deliveryDays: [60, 90], currencies: ['JPY'],
  },
  KR: {
    code: 'KR', flag: 'kr', isEU: false, freightEur: 1750, dutyRate: 0.10,
    preferentialDutyRate: 0,
    preferentialNote: 'EU-Korea FTA: 0 % Zoll bei Ursprungsnachweis (Korea-Fertigung).',
    deliveryDays: [50, 80], currencies: ['KRW'],
  },
  US: {
    code: 'US', flag: 'us', isEU: false, freightEur: 1420, dutyRate: 0.10,
    preferentialDutyRate: 0,
    preferentialNote: 'EU-US-Rahmenabkommen (seit 1. Juli 2026): 0 % für Fahrzeuge mit US-Ursprung – Nachweis erforderlich.',
    deliveryDays: [35, 60], currencies: ['USD'],
  },
  GCC: {
    code: 'GCC', flag: 'ae', isEU: false, freightEur: 1640, dutyRate: 0.10,
    preferentialDutyRate: null, preferentialNote: null,
    deliveryDays: [40, 65], currencies: ['AED'],
  },
  SE: {
    code: 'SE', flag: 'it', isEU: true, freightEur: 660, dutyRate: 0,
    preferentialDutyRate: null, preferentialNote: null,
    deliveryDays: [7, 14], currencies: ['EUR'],
  },
  EE: {
    code: 'EE', flag: 'pl', isEU: true, freightEur: 580, dutyRate: 0,
    preferentialDutyRate: null, preferentialNote: null,
    deliveryDays: [5, 12], currencies: ['EUR'],
  },
};

export interface DestMeta {
  code: DestCode;
  flag: string;
  /** Einfuhrumsatzsteuer- / USt-Satz */
  vatRate: number;
  /** Ermäßigter Satz für Sammlungsstücke (HS 9705) */
  classicVatRate: number;
  port: string;
  /** Bezeichnung der Einfuhrsteuer im Zielland */
  taxLabel: string;
}

export const DESTINATIONS: Record<DestCode, DestMeta> = {
  DE: { code: 'DE', flag: 'de', vatRate: 0.19, classicVatRate: 0.07, port: 'Bremerhaven', taxLabel: 'EUSt' },
  AT: { code: 'AT', flag: 'at', vatRate: 0.20, classicVatRate: 0.13, port: 'Koper', taxLabel: 'USt' },
  NL: { code: 'NL', flag: 'nl', vatRate: 0.21, classicVatRate: 0.09, port: 'Rotterdam', taxLabel: 'BTW' },
  PL: { code: 'PL', flag: 'pl', vatRate: 0.23, classicVatRate: 0.08, port: 'Gdynia', taxLabel: 'VAT' },
};

/** Pauschalen (EUR) – Stand 09/2026. */
export const FEES = {
  insurancePct: 0.011,
  clearingNonEU: 240,
  /** §21 StVZO Einzelabnahme inkl. Scheinwerfer-Umbau (Drittland) */
  inspectionNonEU: 780,
  /** HU/AU bei EU-Ware */
  inspectionEU: 145,
  registration: 98,
  partnerFeeNonEU: 950,
  partnerFeeEU: 450,
  /** Nutzfahrzeug-Aufbau (HS 8704) */
  lcvDutyRate: 0.22,
} as const;

export const MARKET_CODES = Object.keys(MARKETS) as MarketCode[];
export const DEST_CODES = Object.keys(DESTINATIONS) as DestCode[];

export function isMarketCode(v: unknown): v is MarketCode {
  return typeof v === 'string' && v in MARKETS;
}
export function isDestCode(v: unknown): v is DestCode {
  return typeof v === 'string' && v in DESTINATIONS;
}
