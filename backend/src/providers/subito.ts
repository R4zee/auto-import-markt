import { config } from '../config.js';
import type { Listing } from '../domain/types.js';
import { defaultPartnerFor } from '../seed/partners.js';
import { encarDrive } from './encar.js';
import { getJson, num, sleep, str } from './http.js';
import { listingId, normalizeFuel, normalizeTransmission, type MarketProvider, type ProviderResult } from './types.js';
import { makeFromTitle } from './olx.js';

/**
 * Subito.it (Italien) – JSON-Suchendpunkt, den die Website selbst nutzt, kein Key:
 *
 *   GET https://hades.subito.it/v1/search/items?c=2&t=s&lim=100&start=0&sort=datedesc&qso=false&shp=false&urg=false
 *   c=2 Kategorie Auto, t=s Vendita, optional r=<Region>, q=<Suchbegriff>
 *
 * Antwort { ads: Ad[], count_all, start, limit }. Ad: urn ("id:ad:…:list:<id>"), subject, body, type, category,
 * dates{ display }, features{ "/price": { values[{ key, value }] }, "/register_date", "/mileage_scalar", "/car_brand",
 * "/car_model", "/fuel", "/gearbox", "/cubic_capacity", "/car_version", "/car_type", … }, geo{ region, city, town },
 * images[{ cdn_base_url }] (Bild nur mit Rendition, z. B. ?rule=gallery-desktop-2x-jpeg), urls{ default }, advertiser{ type }.
 *
 * Struktur nach Erfahrungswerten und öffentlichen Scrapern (rorystephenson/subito-search u. a.) – beim ersten Lauf mit
 * `npm run probe -- subito` prüfen. Subito lehnt einfache HTTP-Clients teils mit 403 ab (TLS-Fingerprint); auf dem
 * GitHub-Runner curl verwenden (HTTP_CLIENT=curl), sonst Residential-Proxy (EUROPE_PROXY_URL).
 */
export interface SubitoFeatureValue { key?: string | number | null; value?: string | null }
export interface SubitoFeature { uri?: string; label?: string; type?: string; values?: SubitoFeatureValue[] }
export interface SubitoAd {
  urn?: string; subject?: string; body?: string;
  type?: { key?: string; value?: string }; category?: { key?: string; value?: string };
  dates?: { display?: string; expiration?: string };
  features?: Record<string, SubitoFeature>;
  geo?: { region?: { value?: string }; city?: { value?: string; short_name?: string }; town?: { value?: string } };
  images?: Array<{ uri?: string; cdn_base_url?: string; base_url?: string }>;
  urls?: { default?: string; mobile?: string };
  advertiser?: { type?: number | string; name?: string; company?: boolean };
}
export interface SubitoResponse { ads?: SubitoAd[]; count_all?: number; start?: number; limit?: number }

export function subitoFeature(ad: SubitoAd, uri: string): { key: string; value: string } {
  const f = ad.features?.[uri];
  const v = f?.values?.[0];
  return { key: str(v?.key), value: str(v?.value) };
}

export function subitoId(urn: string | undefined): string {
  const s = str(urn);
  const m = s.match(/(\d+)$/);
  return m ? m[1] : s;
}

export function mapSubito(ad: SubitoAd, fetchedAt: string): Listing | null {
  const externalId = subitoId(ad.urn);
  const title = str(ad.subject).trim();
  const price = num(subitoFeature(ad, '/price').key) ?? num(subitoFeature(ad, '/price').value);
  const year = num(subitoFeature(ad, '/register_date').key) ?? num(subitoFeature(ad, '/register_date').value.slice(-4));
  if (!externalId || !title || !price || !year) return null;
  if (ad.type?.key && ad.type.key !== 's') return null; // nur Verkauf

  const make = subitoFeature(ad, '/car_brand').value || makeFromTitle(title);
  const model = subitoFeature(ad, '/car_model').value || title.replace(new RegExp(`^${make.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '').split(/\s+/)[0] || title;
  const version = subitoFeature(ad, '/car_version').value;
  const fuelText = subitoFeature(ad, '/fuel').value;
  const fuel = /elettric/i.test(fuelText) && !/ibrid/i.test(fuelText) ? 'Electric' : /ibrid/i.test(fuelText) ? 'Hybrid' : /diesel/i.test(fuelText) ? 'Diesel' : normalizeFuel(fuelText);
  const gear = subitoFeature(ad, '/gearbox').value;
  const transmission = /manual/i.test(gear) ? 'Manual' : normalizeTransmission(gear || 'automatico');
  const ccmRaw = num(subitoFeature(ad, '/cubic_capacity').key) ?? num(subitoFeature(ad, '/cubic_capacity').value);
  const ccm = fuel === 'Electric' ? null : ccmRaw && ccmRaw > 400 && ccmRaw < 9000 ? Math.round(ccmRaw) : null;
  const km = Math.round(num(subitoFeature(ad, '/mileage_scalar').key) ?? num(subitoFeature(ad, '/mileage_scalar').value) ?? 0);
  const photos = (ad.images ?? [])
    .map((i) => str(i.cdn_base_url ?? i.base_url))
    .filter(Boolean)
    .map((u) => (u.includes('?') ? u : `${u}?rule=${config.subito.imageRule}`));
  const drive = /4x4|awd|4wd|quattro|xdrive|4matic|integrale|q4/i.test(`${title} ${version}`) ? 'AWD' : encarDrive(`${title} ${version}`, make);

  return {
    id: listingId('subito', externalId),
    source: 'subito',
    externalId,
    market: 'SE',
    country: 'it',
    location: str(ad.geo?.town?.value) || str(ad.geo?.city?.value) || str(ad.geo?.region?.value),
    offerType: 'fixed',
    url: str(ad.urls?.default) || null,
    year,
    make,
    model,
    trim: [version, subitoFeature(ad, '/car_type').value].filter(Boolean).join(' · ').slice(0, 120),
    km,
    engine: fuel === 'Electric' ? 'EV' : ccm ? `${(ccm / 1000).toFixed(1)} L` : '',
    engineCcm: ccm,
    co2Gkm: null,
    transmission,
    drive,
    fuel,
    price,
    currency: 'EUR',
    steering: 'LHD',
    auction: null,
    coc: true,
    classic: new Date().getFullYear() - year >= 30,
    dutyRateOverride: null,
    originProof: false,
    resaleEur: null,
    partnerId: defaultPartnerFor('SE'),
    photos,
    photoCount: photos.length,
    damage: [],
    fetchedAt,
    active: true,
  };
}

export class SubitoProvider implements MarketProvider {
  readonly id = 'subito';
  readonly label = 'Subito.it (Italien, Frontend-Endpunkt)';

  enabled(): boolean {
    return config.subito.enabled;
  }

  private http() {
    return { headers: { Accept: 'application/json', 'Accept-Language': 'it', 'User-Agent': config.europe.userAgent, Origin: 'https://www.subito.it', Referer: 'https://www.subito.it/' }, proxyUrl: config.europe.proxyUrl || undefined, timeoutMs: 30000 };
  }

  searchUrl(start: number, region?: string): string {
    const p = new URLSearchParams({ c: '2', t: 's', lim: String(config.subito.pageSize), start: String(start), sort: 'datedesc', qso: 'false', shp: 'false', urg: 'false' });
    if (region) p.set('r', region);
    if (config.subito.minPriceEur > 0) p.set('ps', String(config.subito.minPriceEur)); // Preis ab (Filterparameter der Website)
    if (config.subito.minYear > 0) p.set('rs', String(config.subito.minYear)); // Erstzulassung ab
    return `https://hades.subito.it/v1/search/items?${p}`;
  }

  async fetchAll(): Promise<ProviderResult> {
    const fetchedAt = new Date().toISOString();
    const listings: Listing[] = [];
    const warnings: string[] = [];
    const regions: Array<string | undefined> = config.subito.regions.length ? config.subito.regions : [undefined];
    let failed = 0;
    for (const region of regions) {
      let loaded = 0;
      try {
        for (let page = 0; page < config.subito.pages; page++) {
          const json = await getJson<SubitoResponse>(this.searchUrl(page * config.subito.pageSize, region), this.http());
          const ads = json.ads ?? [];
          if (!ads.length) break;
          for (const ad of ads) {
            const l = mapSubito(ad, fetchedAt);
            if (l && l.price >= config.subito.minPriceEur && l.year >= config.subito.minYear) { listings.push(l); loaded++; }
          }
          if (ads.length < config.subito.pageSize) break;
          await sleep(config.subito.delayMs);
        }
      } catch (e) {
        failed++;
        warnings.push(`Region ${region ?? 'alle'}: ${e instanceof Error ? e.message : String(e)}`);
      }
      warnings.push(`Region ${region ?? 'alle'}: ${loaded} Inserate`);
    }
    if (failed === regions.length) throw new Error(`Subito: alle Abfragen fehlgeschlagen – ${warnings.slice(0, 2).join(' | ')}`);
    return { listings, complete: false, warnings };
  }
}
