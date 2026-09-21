/** Herkunftsmärkte: Japan, Südkorea, USA, Kanada, Golfstaaten, Süd-/Osteuropa. */
export type MarketCode = 'JP' | 'KR' | 'US' | 'CA' | 'GCC' | 'SE' | 'EE';
/** Art des Fahrzeugbriefs bei nordamerikanischen Auktionen (Copart/IAAI): sauber, Unfall-/Totalschaden, wiederaufgebaut, sonstiges */
export type TitleKind = 'clean' | 'salvage' | 'rebuilt' | 'other';
/** Zielländer (Verzollung/Zulassung) wie im Design. */
export type DestCode = 'DE' | 'AT' | 'NL' | 'PL';
export type Lang = 'en' | 'de';
export type DisplayCurrency = 'EUR' | 'USD' | 'GBP' | 'CHF';

export type OfferType = 'auction' | 'fixed';
export type Fuel = 'Petrol' | 'Diesel' | 'Hybrid' | 'Electric';
export type Transmission = 'Automatic' | 'Manual' | 'PDK' | 'Single speed';
export type Drive = 'RWD' | 'FWD' | 'AWD' | '4WD';

export interface AuctionInfo {
  house: string;
  lot: string;
  /** Bewertung laut Auktionsblatt, z. B. "4.5 / B", "Run & Drive" */
  grade: string | null;
  gradeNote: string | null;
  hammerLow: number | null;
  hammerHigh: number | null;
  /** ISO-Zeitpunkt, an dem die Auktion endet */
  endsAt: string;
}

export interface DamageEntry {
  /** Schlüssel der Karosseriestelle (pFront, pBonnet, …) – wird im Frontend übersetzt */
  panel: string;
  /** Auktionsblatt-Code, z. B. "A1", "U2", "W1", "XX"; leer = i. O. */
  code: string;
}

export interface Listing {
  /** Stabil: `${source}:${externalId}` */
  id: string;
  source: string;
  externalId: string;
  market: MarketCode;
  /** ISO-3166-Alpha-2 für die Flagge (jp, kr, us, ae, it, pl, ro, …) */
  country: string;
  /** Stadt / Standort */
  location: string;
  offerType: OfferType;
  url: string | null;
  year: number;
  make: string;
  model: string;
  trim: string;
  km: number;
  /** Motor-Kurzbezeichnung, z. B. "4.0 V6", "77.4 kWh" */
  engine: string;
  engineCcm: number | null;
  /** Motorleistung in kW, sofern die Quelle sie liefert (Vergleichspreis: gleiche Motorisierung) */
  powerKw?: number | null;
  co2Gkm: number | null;
  transmission: Transmission;
  drive: Drive;
  fuel: Fuel;
  price: number;
  currency: string;
  /** Marktplatzweit nur Linkslenker – Feld dient der Filterung beim Import */
  steering: 'LHD' | 'RHD';
  /** Fahrzeugbrief-Art bei US-/Kanada-Auktionen (Filter „US-Titel“); null bei anderen Quellen */
  titleKind?: TitleKind | null;
  auction: AuctionInfo | null;
  /** EU-Übereinstimmungsbescheinigung vorhanden */
  coc: boolean;
  /** Sammlerfahrzeug > 30 Jahre (HS 9705) */
  classic: boolean;
  /** Abweichender Zollsatz (z. B. 0.22 für Nutzfahrzeug-Aufbau) */
  dutyRateOverride: number | null;
  /** Präferenznachweis (Ursprungserklärung) liegt vor → ermäßigter Zollsatz */
  originProof: boolean;
  /** Geschätzter Händler-Wiederverkaufswert im Zielland (EUR) */
  resaleEur: number | null;
  partnerId: string;
  photos: string[];
  photoCount: number;
  damage: DamageEntry[];
  fetchedAt: string;
  active: boolean;
}

export interface Partner {
  id: string;
  name: string;
  /** Kurzzeile, z. B. "Nagoya → Bremerhaven, 12 yrs" */
  note: string;
  markets: MarketCode[];
  email: string | null;
}

export interface ListingQuery {
  q?: string;
  offer?: 'all' | OfferType;
  markets?: MarketCode[];
  make?: string;
  model?: string;
  location?: string;
  yearFrom?: number;
  yearTo?: number;
  maxKm?: number;
  fuels?: Fuel[];
  /** "Automatic" fasst Automatic/PDK/Single speed zusammen */
  transmissions?: Array<'Automatic' | 'Manual'>;
  cocOnly?: boolean;
  /** Fahrzeugbrief-Arten (US/Kanada-Auktionen); gesetzt → nur Inserate mit einer dieser Arten */
  titles?: TitleKind[];
  /** Max. Endpreis in EUR (nach Landed-Cost-Berechnung) */
  maxLandedEur?: number;
  dest?: DestCode;
  /** ref-asc/ref-desc: Abstand des Endpreises zum günstigsten DE-Angebot (Inserate ohne Vergleichspreis zuletzt) */
  sort?: 'landed-asc' | 'landed-desc' | 'year-desc' | 'km-asc' | 'ending' | 'ref-asc' | 'ref-desc';
  page?: number;
  pageSize?: number;
}

export interface CostLine {
  /** Übersetzungsschlüssel (lFob, lFreight, …) */
  key: string;
  /** Platzhalterwerte für die Übersetzung, z. B. { r: 10 } */
  vars?: Record<string, string | number>;
  amountEur: number | null;
}

export interface LandedCost {
  dest: DestCode;
  fxRate: number;
  fobEur: number;
  freightEur: number;
  insuranceEur: number;
  cifEur: number;
  dutyRate: number;
  dutyEur: number;
  vatRate: number;
  vatEur: number;
  clearingEur: number;
  inspectionEur: number;
  registrationEur: number;
  partnerFeeEur: number;
  totalEur: number;
  lines: CostLine[];
  /** Übersetzungsschlüssel der Erläuterung (nEU, nClassic, nLcv, nStd, nPref) */
  noteKey: string;
  noteVars: Record<string, string | number>;
  isEU: boolean;
}

export interface VehicleTax {
  annualEur: number;
  method: string;
  estimated: boolean;
}

/**
 * Vergleichspreis aus dem deutschen Markt (günstigstes vergleichbares Angebot: gleiche Marke, Modell/Variante,
 * Kraftstoff, Baujahrband der Baureihe bzw. Baujahr ±1, Laufleistung höchstens +50 % unter 100.000 km bzw. +30 % darüber).
 */
export interface ReferenceSummary {
  source: string;
  /** Günstigstes vergleichbares Angebot (EUR) */
  minEur: number;
  medianEur: number | null;
  /** Vergleichbare Angebote im Laufleistungsfenster */
  count: number;
  kmFrom: number;
  kmTo: number;
  yearFrom: number;
  yearTo: number;
  /** Inserat mit dem Mindestpreis */
  url: string | null;
  /**
   * Endpreis (inkl. Zoll, Steuer, TÜV, Zulassung) relativ zum Vergleichspreis in Prozent: -20 = 20 % günstiger.
   * null bei Auktionen: dort ist der Preis nur das Start-/Höchstgebot, kein Kaufpreis
   */
  diffPct: number | null;
  /** Baureihe (z. B. "W221"), falls das Baujahrband daraus stammt */
  generation: string | null;
  fetchedAt: string;
}

export interface DecoratedListing extends Listing {
  landed: LandedCost;
  /** Nur für Deutschland berechnet */
  vehicleTax: VehicleTax | null;
  /** Vergleichspreis DE, sofern im Cache (null = keine Daten oder Funktion aus) */
  reference: ReferenceSummary | null;
}
