import type { DamageEntry, Listing } from '../domain/types.js';
import { SEED_PARTNERS } from '../seed/partners.js';
import { listingId, type MarketProvider, type ProviderResult } from './types.js';

/**
 * Beispieldaten aus dem Claude-Design (14 Fahrzeuge). Auktionsenden sind relativ
 * zum Start des Servers, damit die Countdowns im Frontend laufen.
 */
interface RawCar {
  id: string; m: Listing['market']; cty: string; loc: string; type: Listing['offerType']; year: number; make: string;
  model: string; trim: string; km: number; engine: string; ccm: number | null; co2: number | null;
  trans: Listing['transmission']; drive: Listing['drive']; fuel: Listing['fuel']; price: number; ccy: string;
  house?: string; lot?: string; grade?: string; gradeNote?: string; hammer?: [number, number]; ends?: number;
  coc: boolean; duty?: number; classic?: boolean; resale: number; partner: string; photos: number;
}

const RAW: RawCar[] = [
  { id: 'jp1', m: 'JP', cty: 'jp', loc: 'Nagoya', type: 'auction', year: 2023, make: 'Toyota', model: 'Land Cruiser 70', trim: 'ZX 4.0 V6 · LHD export spec', km: 12400, engine: '4.0 V6', ccm: 3956, co2: 276, trans: 'Automatic', drive: '4WD', fuel: 'Petrol', price: 5480000, ccy: 'JPY', house: 'USS Nagoya', lot: '41208', grade: '4.5 / B', gradeNote: 'Light stone chipping on the front bar, interior unmarked, no accident history recorded.', hammer: [5200000, 5900000], ends: 190, coc: false, resale: 78500, partner: 'kaido', photos: 42 },
  { id: 'jp2', m: 'JP', cty: 'jp', loc: 'Yokohama', type: 'fixed', year: 2021, make: 'Lexus', model: 'LX570', trim: 'Sport Package · LHD export spec', km: 38900, engine: '5.7 V8', ccm: 5663, co2: 312, trans: 'Automatic', drive: '4WD', fuel: 'Petrol', price: 9850000, ccy: 'JPY', coc: false, resale: 92000, partner: 'kaido', photos: 31 },
  { id: 'jp3', m: 'JP', cty: 'jp', loc: 'Yokohama', type: 'auction', year: 2019, make: 'Toyota', model: 'Hilux Revo', trim: '2.8 D-4D Double Cab · LHD', km: 64200, engine: '2.8 TD', ccm: 2755, co2: 209, trans: 'Automatic', drive: '4WD', fuel: 'Diesel', price: 3240000, ccy: 'JPY', house: 'TAA Yokohama', lot: '20773', grade: '4 / B', gradeNote: 'Bed liner fitted, two repaired panels declared, service book complete.', hammer: [3050000, 3480000], ends: 2760, coc: false, duty: 0.22, resale: 44000, partner: 'kaido', photos: 28 },
  { id: 'kr1', m: 'KR', cty: 'kr', loc: 'Seoul', type: 'fixed', year: 2022, make: 'Genesis', model: 'G80', trim: '3.5T AWD Luxury', km: 24300, engine: '3.5 V6 T', ccm: 3470, co2: 235, trans: 'Automatic', drive: 'AWD', fuel: 'Petrol', price: 58900000, ccy: 'KRW', coc: true, resale: 56500, partner: 'hanbit', photos: 36 },
  { id: 'kr2', m: 'KR', cty: 'kr', loc: 'Seoul', type: 'auction', year: 2020, make: 'Kia', model: 'Stinger GT', trim: '3.3 T-GDI RWD', km: 61200, engine: '3.3 V6 T', ccm: 3342, co2: 244, trans: 'Automatic', drive: 'RWD', fuel: 'Petrol', price: 28400000, ccy: 'KRW', house: 'Lotte Auto Auction', lot: '7712', grade: 'A / 2', gradeNote: 'Single owner, one repainted rear quarter, 4 mm tread all round.', hammer: [27100000, 30500000], ends: 1560, coc: true, resale: 31800, partner: 'hanbit', photos: 24 },
  { id: 'kr3', m: 'KR', cty: 'kr', loc: 'Incheon', type: 'fixed', year: 2023, make: 'Hyundai', model: 'Ioniq 5', trim: 'Long Range AWD Prestige', km: 18700, engine: '77.4 kWh', ccm: null, co2: 0, trans: 'Single speed', drive: 'AWD', fuel: 'Electric', price: 46200000, ccy: 'KRW', coc: true, resale: 42500, partner: 'hanbit', photos: 29 },
  { id: 'us1', m: 'US', cty: 'us', loc: 'Miami', type: 'fixed', year: 2022, make: 'Chevrolet', model: 'Corvette C8', trim: 'Stingray 3LT Z51', km: 14800, engine: '6.2 V8', ccm: 6162, co2: 290, trans: 'Automatic', drive: 'RWD', fuel: 'Petrol', price: 71500, ccy: 'USD', coc: false, resale: 108000, partner: 'atlantic', photos: 48 },
  { id: 'us2', m: 'US', cty: 'us', loc: 'Newark', type: 'auction', year: 2022, make: 'RAM', model: '1500 TRX', trim: '6.2 Supercharged Crew Cab', km: 31500, engine: '6.2 V8 s/c', ccm: 6166, co2: 395, trans: 'Automatic', drive: '4WD', fuel: 'Petrol', price: 62400, ccy: 'USD', house: 'Copart Newark', lot: '58-11907', grade: 'Run & Drive', gradeNote: 'Clean title, minor front-left cosmetic damage, keys present.', hammer: [58000, 66500], ends: 4260, coc: false, duty: 0.22, resale: 96000, partner: 'atlantic', photos: 52 },
  { id: 'us3', m: 'US', cty: 'us', loc: 'Los Angeles', type: 'fixed', year: 1990, make: 'Mercedes-Benz', model: '300 CE-24', trim: 'C124 · California car', km: 98400, engine: '3.0 I6', ccm: 2960, co2: null, trans: 'Automatic', drive: 'RWD', fuel: 'Petrol', price: 27900, ccy: 'USD', coc: false, classic: true, resale: 39500, partner: 'atlantic', photos: 61 },
  { id: 'gc1', m: 'GCC', cty: 'ae', loc: 'Dubai', type: 'fixed', year: 2021, make: 'Nissan', model: 'Patrol Nismo', trim: '5.6 V8 · GCC spec', km: 42600, engine: '5.6 V8', ccm: 5552, co2: 340, trans: 'Automatic', drive: '4WD', fuel: 'Petrol', price: 245000, ccy: 'AED', coc: false, resale: 82000, partner: 'gulfbridge', photos: 33 },
  { id: 'gc2', m: 'GCC', cty: 'ae', loc: 'Dubai', type: 'auction', year: 2020, make: 'Mercedes-AMG', model: 'G 63', trim: '4.0 V8 Biturbo · GCC spec', km: 55100, engine: '4.0 V8 BT', ccm: 3982, co2: 299, trans: 'Automatic', drive: '4WD', fuel: 'Petrol', price: 598000, ccy: 'AED', house: 'Emirates Auction', lot: '3391', grade: 'Grade 2', gradeNote: 'Full Mercedes service history, desert-spec cooling, kerbed front wheels.', hammer: [575000, 640000], ends: 540, coc: false, resale: 168000, partner: 'gulfbridge', photos: 45 },
  { id: 'se1', m: 'SE', cty: 'it', loc: 'Milan', type: 'fixed', year: 2019, make: 'Alfa Romeo', model: 'Giulia', trim: 'Quadrifoglio 2.9 V6 · Milan', km: 57800, engine: '2.9 V6 BT', ccm: 2891, co2: 206, trans: 'Automatic', drive: 'RWD', fuel: 'Petrol', price: 48900, ccy: 'EUR', coc: true, resale: 62500, partner: 'adriatica', photos: 27 },
  { id: 'ee1', m: 'EE', cty: 'ro', loc: 'Bucharest', type: 'auction', year: 2020, make: 'Porsche', model: '911 Carrera S', trim: '992 · PDK · Bucharest', km: 39400, engine: '3.0 flat-6', ccm: 2981, co2: 208, trans: 'PDK', drive: 'RWD', fuel: 'Petrol', price: 94500, ccy: 'EUR', house: 'Auto Aukcja RO', lot: 'RO-2218', grade: 'Grade 1', gradeNote: 'Two owners, Porsche approved inspection passed, ceramic-coated.', hammer: [91000, 99500], ends: 1980, coc: true, resale: 118000, partner: 'carpathia', photos: 38 },
  { id: 'ee2', m: 'EE', cty: 'pl', loc: 'Warsaw', type: 'fixed', year: 2021, make: 'BMW', model: 'M4 Competition', trim: 'G82 · xDrive · Warsaw', km: 28900, engine: '3.0 I6 BT', ccm: 2993, co2: 234, trans: 'Automatic', drive: 'AWD', fuel: 'Petrol', price: 67200, ccy: 'EUR', coc: true, resale: 79500, partner: 'carpathia', photos: 34 },
];

function damageFor(c: RawCar): DamageEntry[] {
  if (c.type !== 'auction') return [];
  return [
    { panel: 'pFront', code: 'A1' }, { panel: 'pBonnet', code: '' }, { panel: 'pFlWing', code: 'U1' }, { panel: 'pFrWing', code: '' },
    { panel: 'pLDoor', code: 'A2' }, { panel: 'pRDoor', code: '' }, { panel: 'pQuarter', code: c.grade?.startsWith('A') ? 'W1' : '' }, { panel: 'pTail', code: 'A1' },
  ];
}

export class MockProvider implements MarketProvider {
  readonly id = 'mock';
  readonly label = 'Beispieldaten (Design)';
  private readonly t0 = Date.now();

  enabled(): boolean {
    return true;
  }

  async fetchAll(): Promise<ProviderResult> {
    const now = new Date().toISOString();
    const listings: Listing[] = RAW.map((c) => ({
      id: listingId(this.id, c.id),
      source: this.id,
      externalId: c.id,
      market: c.m,
      country: c.cty,
      location: c.loc,
      offerType: c.type,
      url: null,
      year: c.year,
      make: c.make,
      model: c.model,
      trim: c.trim,
      km: c.km,
      engine: c.engine,
      engineCcm: c.ccm,
      co2Gkm: c.co2,
      transmission: c.trans,
      drive: c.drive,
      fuel: c.fuel,
      price: c.price,
      currency: c.ccy,
      steering: 'LHD',
      auction: c.type === 'auction' && c.house && c.lot
        ? {
            house: c.house,
            lot: c.lot,
            grade: c.grade ?? null,
            gradeNote: c.gradeNote ?? null,
            hammerLow: c.hammer?.[0] ?? null,
            hammerHigh: c.hammer?.[1] ?? null,
            endsAt: new Date(this.t0 + (c.ends ?? 0) * 60000).toISOString(),
          }
        : null,
      coc: c.coc,
      classic: c.classic === true,
      dutyRateOverride: c.duty ?? null,
      originProof: false,
      resaleEur: c.resale,
      partnerId: c.partner,
      photos: [],
      photoCount: c.photos,
      damage: damageFor(c),
      fetchedAt: now,
      active: true,
    }));
    return { listings, partners: SEED_PARTNERS, complete: true };
  }
}
