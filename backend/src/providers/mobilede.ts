import { config } from '../config.js';
import { marketForCountry, MARKET_COUNTRIES } from '../domain/markets.js';
import type { Listing, MarketCode } from '../domain/types.js';
import { defaultPartnerFor } from '../seed/partners.js';
import { getJson, num, sleep, str } from './http.js';
import { encarDrive } from './encar.js';
import { listingId, normalizeFuel, normalizeTransmission, type MarketProvider, type ProviderResult } from './types.js';

/**
 * mobile.de Search API – offizielle Schnittstelle (services.mobile.de/manual/search-api.html), Zugang nur mit
 * API-Account über den mobile.de-Kundensupport (HTTP Basic). mobile.de listet auch Händler aus Italien, Spanien,
 * Polen, Tschechien, Ungarn, Rumänien … – der Adapter fragt je Verkäuferland ab und ordnet es dem Markt
 * Süd- bzw. Osteuropa zu (domain/markets.ts, MARKET_COUNTRIES).
 *
 *   GET https://services.mobile.de/search-api/search?classification=refdata/classes/Car&country=IT&page.number=1&page.size=100
 *   Header: Accept: application/vnd.de.mobile.api+json, Authorization: Basic …
 *
 * Feldnamen folgen der Doku (JSON-Abbildung des XML-Schemas: "@key"/"@value"-Attribute, "search-result" → "ads" → "ad").
 * Die Auswertung ist tolerant gegenüber beiden Schreibweisen und ist beim ersten Live-Lauf gegen die echte
 * Antwort zu prüfen (wie beim MarketCheck-Adapter).
 */
export interface MobileDeAd {
  '@key'?: string; key?: string; '@url'?: string; url?: string;
  'detail-page'?: { '@url'?: string; url?: string };
  'creation-date'?: { '@value'?: string };
  price?: { 'consumer-price-amount'?: { '@value'?: string | number; '@currency'?: string }; value?: string | number; currency?: string };
  vehicle?: {
    make?: { '@key'?: string; key?: string } | string;
    model?: { '@key'?: string; key?: string } | string;
    'model-description'?: { '@value'?: string } | string;
    category?: { '@key'?: string } | string;
    specifics?: {
      'first-registration'?: { '@value'?: string };
      mileage?: { '@value'?: string | number };
      fuel?: { '@key'?: string } | string;
      gearbox?: { '@key'?: string } | string;
      power?: { '@value'?: string | number };
      'cubic-capacity'?: { '@value'?: string | number };
      'four-wheel-drive'?: { '@value'?: string | boolean };
      emissions?: { 'co2-emission'?: { '@value'?: string | number } };
    };
  };
  seller?: { type?: { '@key'?: string }; address?: { country?: { '@key'?: string } | string; city?: { '@value'?: string } | string; zipcode?: { '@value'?: string } } };
  images?: { image?: Array<{ representation?: Array<{ '@size'?: string; '@url'?: string; size?: string; url?: string }> }> };
}

export interface MobileDeSearchResult {
  'search-result'?: { '@total'?: string | number; total?: string | number; 'max-pages'?: string | number; ads?: { ad?: MobileDeAd[] | MobileDeAd } };
}

/** "@key"/"@value"-Objekt oder Rohwert → String */
export function attr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return str(o['@key'] ?? o['@value'] ?? o['@url'] ?? o.key ?? o.value ?? o.url ?? '');
  }
  return str(v);
}

const NUTZFAHRZEUG = /(Van|Truck|Bus|Trailer|Motorbike|Caravan|Motorhome)/i;

export function mapMobileDe(ad: MobileDeAd, fetchedAt: string): Listing | null {
  const externalId = attr(ad['@key'] ?? ad.key);
  const v = ad.vehicle ?? {};
  const s = v.specifics ?? {};
  const make = attr(v.make);
  const model = attr(v.model) || attr(v['model-description']).split(' ')[0];
  const price = num(ad.price?.['consumer-price-amount']?.['@value'] ?? ad.price?.value);
  const firstReg = attr(s['first-registration']); // YYYYMM
  const year = firstReg.length >= 4 ? Number(firstReg.slice(0, 4)) : null;
  const country = attr(ad.seller?.address?.country).toLowerCase();
  const market: MarketCode | null = marketForCountry(country);
  if (!externalId || !make || !model || !price || !year || !market) return null;
  const category = attr(v.category);
  if (NUTZFAHRZEUG.test(category)) return null;

  const currency = str(ad.price?.['consumer-price-amount']?.['@currency'] ?? ad.price?.currency ?? 'EUR') || 'EUR';
  const fuelRaw = attr(s.fuel); // PETROL, DIESEL, ELECTRICITY, HYBRID, HYBRID_DIESEL, LPG, CNG …
  const fuel = fuelRaw.toUpperCase().startsWith('ELECTRIC') ? 'Electric' : normalizeFuel(fuelRaw);
  const gearbox = attr(s.gearbox); // MANUAL_GEAR, AUTOMATIC_GEAR, SEMIAUTOMATIC_GEAR
  const ccm = num(s['cubic-capacity']?.['@value']);
  const co2 = num(s.emissions?.['co2-emission']?.['@value']);
  const awd = ['true', '1', 'yes'].includes(attr(s['four-wheel-drive']).toLowerCase());
  const description = attr(v['model-description']);
  const photos = (ad.images?.image ?? [])
    .map((img) => {
      const reps = img.representation ?? [];
      const best = reps.find((r) => (r['@size'] ?? r.size) === 'XXL') ?? reps.find((r) => (r['@size'] ?? r.size) === 'XL') ?? reps[reps.length - 1];
      return best ? str(best['@url'] ?? best.url) : '';
    })
    .filter(Boolean);
  const city = attr(ad.seller?.address?.city);

  return {
    id: listingId('mobilede', externalId),
    source: 'mobilede',
    externalId,
    market,
    country,
    location: city,
    offerType: 'fixed',
    url: str(ad['detail-page']?.['@url'] ?? ad['detail-page']?.url ?? ad['@url'] ?? ad.url) || null,
    year,
    make,
    model,
    trim: description.replace(new RegExp(`^${make}\\s+${model}\\s*`, 'i'), '').trim(),
    km: Math.round(num(s.mileage?.['@value']) ?? 0),
    engine: fuel === 'Electric' ? 'EV' : ccm ? `${(ccm / 1000).toFixed(1)} L` : '',
    engineCcm: fuel === 'Electric' ? null : ccm,
    co2Gkm: co2,
    transmission: gearbox.toUpperCase().startsWith('MANUAL') ? 'Manual' : normalizeTransmission(gearbox),
    drive: awd ? 'AWD' : encarDrive(description, make),
    fuel,
    price,
    currency,
    steering: 'LHD', // Kontinentaleuropa; Rechtslenker (UK/IE) werden über die Länderliste gar nicht abgefragt
    auction: null,
    coc: true, // EU-Fahrzeug: Übereinstimmungsbescheinigung Standard
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

export class MobileDeProvider implements MarketProvider {
  readonly id = 'mobilede';
  readonly label = 'mobile.de Search API (Süd-/Osteuropa)';

  enabled(): boolean {
    return config.mobilede.username.length > 0 && config.mobilede.password.length > 0;
  }

  private headers(): Record<string, string> {
    return {
      Accept: 'application/vnd.de.mobile.api+json',
      'Accept-Language': 'de',
      Authorization: `Basic ${Buffer.from(`${config.mobilede.username}:${config.mobilede.password}`).toString('base64')}`,
    };
  }

  buildUrl(country: string, page: number): string {
    const p = new URLSearchParams();
    p.set('classification', 'refdata/classes/Car');
    p.set('country', country.toUpperCase());
    if (config.mobilede.minPriceEur > 0) p.set('price.min', String(config.mobilede.minPriceEur));
    if (config.mobilede.minYear > 0) p.set('firstRegistrationDate.min', `${config.mobilede.minYear}-01`);
    p.set('damageUnrepaired', 'NO_DAMAGE_UNREPAIRED');
    p.set('sort.field', 'modificationTime');
    p.set('sort.order', 'DESCENDING');
    p.set('page.number', String(page));
    p.set('page.size', String(config.mobilede.pageSize));
    return `${config.mobilede.baseUrl}/search-api/search?${p}`;
  }

  async fetchAll(): Promise<ProviderResult> {
    const fetchedAt = new Date().toISOString();
    const listings: Listing[] = [];
    const warnings: string[] = [];
    let failed = 0;
    const countries = config.mobilede.countries.length ? config.mobilede.countries : [...MARKET_COUNTRIES.SE, ...MARKET_COUNTRIES.EE];
    for (const country of countries) {
      let loaded = 0;
      try {
        for (let page = 1; page <= config.mobilede.pages; page++) {
          const json = await getJson<MobileDeSearchResult>(this.buildUrl(country, page), { headers: this.headers(), timeoutMs: 30000 });
          const result = json['search-result'] ?? {};
          const adsRaw = result.ads?.ad;
          const ads = Array.isArray(adsRaw) ? adsRaw : adsRaw ? [adsRaw] : [];
          for (const ad of ads) {
            const l = mapMobileDe(ad, fetchedAt);
            if (l) { listings.push(l); loaded++; }
          }
          const maxPages = num(result['max-pages']);
          if (!ads.length || (maxPages != null && page >= maxPages)) break;
          await sleep(config.mobilede.delayMs);
        }
      } catch (e) {
        failed++;
        warnings.push(`${country.toUpperCase()}: ${e instanceof Error ? e.message : String(e)}`);
      }
      warnings.push(`${country.toUpperCase()}: ${loaded} Inserate`);
    }
    if (countries.length && failed === countries.length) throw new Error(`mobile.de: alle Länderabfragen fehlgeschlagen – ${warnings.slice(0, 2).join(' | ')}`);
    // Nur ein Lauf ohne Fehler deaktiviert nicht mehr gelistete Fahrzeuge
    return { listings, complete: failed === 0, warnings };
  }
}
