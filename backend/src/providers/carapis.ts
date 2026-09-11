import { config } from '../config.js';
import { isMarketCode } from '../domain/markets.js';
import type { Listing, MarketCode } from '../domain/types.js';
import { defaultPartnerFor } from '../seed/partners.js';
import { carapisEnabled, fetchVehicles, type CarapisVehicle } from '../services/carapisClient.js';
import { num, sleep, str } from './http.js';
import { listingId, normalizeDrive, normalizeFuel, type MarketProvider, type ProviderResult } from './types.js';

/**
 * Carapis Catalog API – ein Adapter für alle dort angebotenen Märkte (Encar, KB Chachacha,
 * Goo-net, mobile.de, Dubizzle …). Quellen und Marktzuordnung über CARAPIS_SOURCES,
 * z. B. "encar:KR,kbchachacha:KR,dubizzle:GCC". Die Quellcodes liefert
 * GET /api/admin/carapis/sources (bzw. /apix/catalog_api/sources/).
 *
 * Die Antwortfelder des Vehicle-Objekts sind in der Doku nicht vollständig beschrieben;
 * das Mapping liest daher mehrere gebräuchliche Feldnamen. Mit
 * GET /api/admin/carapis/probe?source=encar lässt sich ein Rohdatensatz neben dem
 * Mapping-Ergebnis ansehen.
 */

const COUNTRY: Record<MarketCode, string> = { JP: 'jp', KR: 'kr', US: 'us', GCC: 'ae', SE: 'it', EE: 'pl' };
const DEFAULT_CCY: Record<MarketCode, string> = { JP: 'JPY', KR: 'KRW', US: 'USD', GCC: 'AED', SE: 'EUR', EE: 'EUR' };

export function parseSources(spec: string): Array<{ source: string; market: MarketCode }> {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [source, market] = s.split(':').map((x) => x.trim());
      return { source, market: isMarketCode(market) ? market : ('KR' as MarketCode) };
    });
}

/** Erstes gesetztes Feld aus einer Liste möglicher Namen (auch verschachtelt "a.b"). */
export function pick(o: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = k.split('.').reduce<unknown>((acc, part) => (acc != null && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined), o);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/** Bekannte Schreibweisen, die aus Slugs/Title-Case nicht korrekt zurückgewonnen werden. */
const BRAND_FIX: Record<string, string> = {
  bmw: 'BMW', 'kg mobility': 'KG Mobility', 'kg-mobility': 'KG Mobility', ssangyong: 'SsangYong', 'mercedes-benz': 'Mercedes-Benz',
  'mercedes benz': 'Mercedes-Benz', 'land rover': 'Land Rover', 'land-rover': 'Land Rover', 'rolls-royce': 'Rolls-Royce', 'alfa romeo': 'Alfa Romeo',
  'renault korea': 'Renault Korea', 'renault-korea': 'Renault Korea', gmc: 'GMC', ram: 'RAM', mg: 'MG', ds: 'DS', byd: 'BYD', 'aston martin': 'Aston Martin',
  mclaren: 'McLaren', 'mercedes-amg': 'Mercedes-AMG', volkswagen: 'Volkswagen', citroen: 'Citroën', skoda: 'Škoda', hyundai: 'Hyundai', kia: 'Kia', genesis: 'Genesis',
};

/** "3series" → "3 Series", "gs300" → "GS300", "e-class" → "E-Class" – für Slug-artige Modellnamen. */
export function prettyModel(raw: string): string {
  const s = raw.trim();
  if (!s) return s;
  const slugLike = /^[a-z0-9]+(-[a-z0-9]+)*$/i.test(s) && (s.includes('-') || /^\d/.test(s) || /^[a-z]{1,3}\d/i.test(s));
  if (!slugLike) return s;
  return s
    .split('-')
    .map((part) => {
      if (/^\d+series$/i.test(part)) return `${part.replace(/series/i, '')} Series`; // 3series → 3 Series
      if (/^[a-z]{1,3}\d+[a-z]*$/i.test(part)) return part.toUpperCase();            // gs300, x5, q7, e63s
      if (/^\d+$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join('-'); // Bindestrich behalten (E-Class, C-Class)
}

export function prettyBrand(raw: string): string {
  const s = raw.trim();
  const fixed = BRAND_FIX[s.toLowerCase()];
  if (fixed) return fixed;
  if (s.length <= 3) return s.toUpperCase();
  return s.replace(/(^|[\s-])([a-z])/g, (m, sep: string, ch: string) => sep + ch.toUpperCase());
}

function nameOf(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return str(o.name ?? o.title ?? o.label ?? o.slug ?? o.code ?? '');
  }
  return String(v);
}

function photoList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((p) => (typeof p === 'string' ? p : nameOf(pick((p ?? {}) as Record<string, unknown>, 'url', 'image', 'src', 'large', 'original', 'medium'))))
    .filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u));
}

/** Antrieb: explizites Feld, sonst Hinweise in Ausstattung/Modell, sonst Heuristik nach Marke. */
export function guessDrive(explicit: string, hints: string, make: string): Listing['drive'] {
  if (explicit && explicit.toLowerCase() !== 'unknown') return normalizeDrive(explicit);
  const h = hints.toUpperCase();
  if (/4WD|4X4|AWD|HTRAC|XDRIVE|4MATIC|QUATTRO|4MOTION|ALL4|SH-AWD|E-FOUR/.test(h)) return 'AWD';
  if (/PICKUP|LAND CRUISER|PATROL|WRANGLER|DEFENDER|G 63|G-CLASS|GLADIATOR|REXTON|MOHAVE/.test(h)) return '4WD';
  if (/BMW|MERCEDES|GENESIS|LEXUS|PORSCHE|JAGUAR|MASERATI|ROLLS|BENTLEY|CADILLAC|DODGE|CHEVROLET CORVETTE|MUSTANG/i.test(`${make} ${hints}`)) return 'RWD';
  return 'FWD';
}

export function carapisTransmission(v: unknown): Listing['transmission'] {
  const s = str(v).toLowerCase();
  if (s === 'manual' || s.includes('manual') || s.includes('schalt')) return 'Manual';
  return 'Automatic'; // auto, cvt, dct, semi_auto, other, unknown
}

export function carapisFuel(v: unknown): Listing['fuel'] {
  const s = str(v).toLowerCase();
  if (s === 'hydrogen') return 'Electric';
  if (s === 'plug_hybrid') return 'Hybrid';
  return normalizeFuel(s);
}

/** Preis + Währung: bevorzugt Originalpreis der Quelle, sonst USD-Normalpreis. */
export function carapisPrice(o: Record<string, unknown>, fallbackCcy: string): { price: number; currency: string } | null {
  const orig = num(pick(o, 'price_original', 'original_price', 'price_local', 'local_price', 'price.amount', 'price.original'));
  const origCcy = str(pick(o, 'currency', 'price_currency', 'original_currency', 'currency_code', 'price.currency')).toUpperCase();
  if (orig && origCcy && origCcy !== 'USD') return { price: orig, currency: origCcy };
  const plain = num(pick(o, 'price'));
  if (plain && origCcy) return { price: plain, currency: origCcy };
  const usd = num(pick(o, 'price_usd', 'usd_price', 'price.usd'));
  if (usd) return { price: usd, currency: 'USD' };
  if (plain) return { price: plain, currency: fallbackCcy === 'USD' ? 'USD' : 'USD' };
  if (orig) return { price: orig, currency: origCcy || fallbackCcy };
  return null;
}

export function mapCarapis(o: CarapisVehicle, market: MarketCode, fetchedAt: string, sourceCode: string): Listing | null {
  const id = str(pick(o, 'id', 'uuid', 'pk'));
  const year = num(pick(o, 'year', 'manufacturing_year', 'model_year', 'production_year'));
  const make = prettyBrand(nameOf(pick(o, 'brand_name', 'brand.name', 'brand', 'make', 'manufacturer', 'brand_slug')));
  const model = prettyModel(nameOf(pick(o, 'model_name', 'model.name', 'model', 'model_slug')));
  const priced = carapisPrice(o, DEFAULT_CCY[market]);
  if (!id || !year || !make || !model || !priced) return null;

  const steering = str(pick(o, 'steering', 'steering_wheel', 'steering_side')).toLowerCase().includes('right') ? 'RHD' : 'LHD';
  const ccm = num(pick(o, 'engine_cc', 'engine_displacement', 'displacement', 'engine_volume'));
  const fuel = carapisFuel(pick(o, 'fuel_type', 'fuel'));
  const photos = photoList(pick(o, 'photos', 'images', 'photo_urls', 'image_urls', 'gallery'));
  const thumb = str(pick(o, 'image', 'thumbnail', 'main_photo', 'photo', 'cover_image'));
  if (!photos.length && /^https?:\/\//.test(thumb)) photos.push(thumb);
  const url = str(pick(o, 'url', 'source_url', 'listing_url', 'original_url', 'external_url', 'link'));
  const location = nameOf(pick(o, 'location', 'city', 'region', 'address', 'dealer_location', 'dealer.city'));
  const trimBits = [str(pick(o, 'trim', 'grade', 'variant', 'badge', 'version')), str(pick(o, 'body_type')) !== 'unknown' ? str(pick(o, 'body_type')) : ''].filter(Boolean);
  const accident = pick(o, 'has_accident');
  const inspected = pick(o, 'inspection_passed');

  const endsRaw = pick(o, 'auction_end', 'ends_at', 'auction_date', 'auction_ends_at');
  const endsAt = endsRaw ? new Date(String(endsRaw)) : null;
  const lot = str(pick(o, 'lot_number', 'lot', 'auction_lot'));
  const isAuction = !!lot && !!endsAt && !Number.isNaN(endsAt.getTime()) && endsAt.getTime() > Date.now();

  return {
    id: listingId('carapis', id),
    source: 'carapis',
    externalId: id,
    market,
    country: COUNTRY[market],
    location,
    offerType: isAuction ? 'auction' : 'fixed',
    url: url || null,
    year,
    make,
    model,
    trim: trimBits.join(' · '),
    km: Math.round(num(pick(o, 'mileage', 'mileage_km', 'odometer', 'km')) ?? 0),
    engine: fuel === 'Electric' ? 'EV' : ccm ? `${(ccm / 1000).toFixed(1)} L` : '',
    engineCcm: fuel === 'Electric' ? null : ccm,
    co2Gkm: num(pick(o, 'co2', 'co2_gkm', 'co2_emissions')),
    transmission: carapisTransmission(pick(o, 'transmission', 'gearbox')),
    drive: guessDrive(str(pick(o, 'drivetrain', 'drive_type', 'drive', 'wheel_drive')), `${trimBits.join(' ')} ${model}`, make),
    fuel,
    price: priced.price,
    currency: priced.currency,
    steering,
    auction: isAuction
      ? {
          house: str(pick(o, 'auction_house', 'source_name', 'source.name')) || sourceCode,
          lot,
          grade: str(pick(o, 'auction_grade', 'grade_score', 'inspection_grade')) || null,
          gradeNote: [accident === true ? 'Accident history recorded' : accident === false ? 'No accident recorded' : null, inspected === true ? 'Inspection passed' : null].filter(Boolean).join('. ') || null,
          hammerLow: null,
          hammerHigh: null,
          endsAt: endsAt!.toISOString(),
        }
      : null,
    coc: market === 'SE' || market === 'EE',
    classic: new Date().getFullYear() - year >= 30,
    dutyRateOverride: null,
    originProof: false,
    resaleEur: null,
    partnerId: defaultPartnerFor(market),
    photos,
    photoCount: photos.length,
    damage: [],
    fetchedAt,
    active: true,
  };
}

export class CarapisProvider implements MarketProvider {
  readonly id = 'carapis';
  readonly label = 'Carapis Catalog API (Multi-Markt)';

  enabled(): boolean {
    return carapisEnabled() && parseSources(config.carapis.sources).length > 0;
  }

  async fetchAll(): Promise<ProviderResult> {
    const fetchedAt = new Date().toISOString();
    const listings: Listing[] = [];
    const brands = config.carapis.brands.length ? config.carapis.brands : [undefined];
    for (const { source, market } of parseSources(config.carapis.sources)) {
      for (const brand of brands) {
        for (let page = 1; page <= config.carapis.pages; page++) {
          const res = await fetchVehicles({ source, brand, page, page_size: config.carapis.pageSize, available_only: true, is_new_vehicle: false });
          for (const v of res.results) {
            const mapped = mapCarapis(v, market, fetchedAt, source);
            if (mapped) listings.push(mapped);
          }
          if (!res.next || res.results.length === 0) break;
          await sleep(200);
        }
      }
    }
    return { listings, complete: false };
  }
}
