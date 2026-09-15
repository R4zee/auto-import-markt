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
 * Antwort (Live 14.09.2026, 535.000 Inserate) { ads: Ad[], count_all, start, lines, filters }. Ad: urn ("id:ad:<uuid>:list:<id>"),
 * subject, body, type{ key "s" }, category{ key "2" }, dates{ display_iso8601 }, features: Array von
 * { uri, type, label, values[{ key, value, … }] } mit "/price" (key "13400"), "/year" (key "2022"), "/register_date" ("06/2022"),
 * "/mileage_scalar" (key "90500"), "/fuel" ("Diesel" | "Benzina" | "Gpl" | "Metano" | "Elettrica" | "Ibrida"), "/gearbox"
 * ("Manuale" | "Automatico"), "/car" (pack: level 0 Marca, 1 Modello mit group_label, 2 Versione), "/car_type", "/power",
 * "/pollution", "/vehicle_status"; geo{ region, city, town }; images[{ cdn_base_url }] (Bild nur mit Rendition
 * ?rule=gallery-desktop-2x-jpeg); urls{ default }; advertiser{ company }. Hubraum liefert die Liste nicht.
 */
export interface SubitoFeatureValue { key?: string | number | null; value?: string | null; label?: string; level?: number; group_key?: string; group_label?: string }
export interface SubitoFeature { uri?: string; label?: string; type?: string; values?: SubitoFeatureValue[] }
export interface SubitoAd {
  urn?: string; subject?: string; body?: string;
  type?: { key?: string; value?: string }; category?: { key?: string; value?: string; friendly_name?: string };
  dates?: { display?: string; expiration?: string; display_iso8601?: string };
  /** Objekt je URI oder Array von Features – beide Formen kommen vor */
  features?: Record<string, SubitoFeature> | SubitoFeature[];
  geo?: { region?: { value?: string }; city?: { value?: string; short_name?: string }; town?: { value?: string } };
  images?: Array<{ uri?: string; cdn_base_url?: string; base_url?: string }>;
  urls?: { default?: string; mobile?: string };
  advertiser?: { type?: number | string; name?: string; company?: boolean };
}
export interface SubitoResponse { ads?: SubitoAd[]; count_all?: number; start?: number; limit?: number }

function findFeature(ad: SubitoAd, uri: string): SubitoFeature | undefined {
  const fs = ad.features;
  const bare = uri.replace(/^\//, '');
  if (Array.isArray(fs)) return fs.find((x) => x.uri === uri || x.uri === bare || x.label?.toLowerCase() === bare);
  return fs ? fs[uri] ?? fs[bare] : undefined;
}

export function subitoFeature(ad: SubitoAd, uri: string): { key: string; value: string } {
  const v = findFeature(ad, uri)?.values?.[0];
  return { key: str(v?.key), value: str(v?.value) };
}

/** "RENAULT" → "Renault", Kurzmarken (BMW, MG, DS) bleiben groß */
export function subitoCase(s: string): string {
  const t = s.trim();
  if (t !== t.toUpperCase() || t.length <= 3) return t;
  return t.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/**
 * Paket "/car" (Live-Antwort 14.09.2026): values[level 0] = Marca, [level 1] = Modello (group_label = Baureihe,
 * value = Baureihe + Generation, z. B. "Captur 2ª serie"), [level 2] = Versione.
 */
export function subitoCar(ad: SubitoAd): { make: string; model: string; version: string } {
  const vals = findFeature(ad, '/car')?.values ?? [];
  const at = (level: number) => vals.find((v) => v.level === level) ?? vals[level];
  const make = subitoCase(str(at(0)?.value));
  const modelVal = at(1);
  const model = str(modelVal?.group_label) || str(modelVal?.value).replace(/\s+\d+[ªa°]?\s+serie$/i, '');
  return { make, model, version: str(at(2)?.value) };
}

/** Rückfall auf den Beschreibungstext (z. B. "Immatricolazione: 10/2017, Chilometraggio: 169.000 km … 1598 cc") */
export function subitoFromBody(body: string | undefined): { year: number | null; km: number | null; ccm: number | null; price: number | null } {
  const b = str(body);
  const year = b.match(/Immatricolazione:\s*(?:\d{1,2}\/)?((?:19|20)\d{2})/i)?.[1];
  const km = b.match(/Chilometraggio:\s*([\d.]+)\s*km/i)?.[1];
  const ccm = b.match(/\b(\d{3,4})\s*cc\b/i)?.[1];
  const price = b.match(/Prezzo:\s*€?\s*([\d.]+)/i)?.[1];
  return {
    year: year ? Number(year) : null,
    km: km ? Number(km.replace(/\./g, '')) : null,
    ccm: ccm ? Number(ccm) : null,
    price: price ? Number(price.replace(/\./g, '')) : null,
  };
}

export function subitoId(urn: string | undefined): string {
  const s = str(urn);
  const m = s.match(/(\d+)$/);
  return m ? m[1] : s;
}

export function mapSubito(ad: SubitoAd, fetchedAt: string): Listing | null {
  const externalId = subitoId(ad.urn);
  const title = str(ad.subject).trim();
  const fromBody = subitoFromBody(ad.body);
  const priceFeature = subitoFeature(ad, '/price');
  const price = num(priceFeature.key) ?? num(priceFeature.value.replace(/\./g, '')) ?? fromBody.price;
  // "/year" = Zulassungsjahr (key "2022"); "/register_date" hat die Form "06/2022"
  const yearRaw = num(subitoFeature(ad, '/year').key)
    ?? num(subitoFeature(ad, '/register_date').key.match(/(19|20)\d{2}/)?.[0])
    ?? fromBody.year;
  const year = yearRaw && yearRaw > 1900 && yearRaw < 2100 ? yearRaw : null;
  if (!externalId || !title || !price || !year) return null;
  if (ad.type?.key && ad.type.key !== 's') return null; // nur Verkauf

  const car = subitoCar(ad);
  const make = car.make || subitoFeature(ad, '/car_brand').value || makeFromTitle(title);
  const model = car.model || subitoFeature(ad, '/car_model').value || title.replace(new RegExp(`^${make.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '').split(/\s+/)[0] || title;
  const version = car.version || subitoFeature(ad, '/car_version').value;
  const bodyText = str(ad.body);
  const fuelText = subitoFeature(ad, '/fuel').value || (bodyText.match(/\b(Diesel|Benzina|Elettrica|Ibrida|GPL|Metano)\b/i)?.[1] ?? ''); // Gpl/Metano → Petrol
  const fuel = /elettric/i.test(fuelText) && !/ibrid/i.test(fuelText) ? 'Electric' : /ibrid/i.test(fuelText) ? 'Hybrid' : /diesel/i.test(fuelText) ? 'Diesel' : normalizeFuel(fuelText);
  const gear = subitoFeature(ad, '/gearbox').value || (bodyText.match(/\b(manuale|automatico|automatica)\b/i)?.[1] ?? '');
  const transmission = /manual/i.test(gear) ? 'Manual' : normalizeTransmission(gear || 'automatico');
  const ccmRaw = num(subitoFeature(ad, '/cubic_capacity').key) ?? num(subitoFeature(ad, '/cubic_capacity').value) ?? fromBody.ccm;
  const ccm = fuel === 'Electric' ? null : ccmRaw && ccmRaw > 400 && ccmRaw < 9000 ? Math.round(ccmRaw) : null;
  const kmFeature = subitoFeature(ad, '/mileage_scalar');
  const km = Math.round(num(kmFeature.key) ?? num(kmFeature.value.replace(/\./g, '')) ?? fromBody.km ?? 0);
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
    return { headers: { Accept: 'application/json', 'Accept-Language': 'it', 'User-Agent': config.europe.userAgent, Origin: 'https://www.subito.it', Referer: 'https://www.subito.it/' }, proxyUrl: config.europe.proxyUrl || undefined, timeoutMs: 30000, nodeOnly: true };
  }

  /** Nur belegte Parameter; Mindestpreis/-baujahr werden nach dem Abruf gefiltert (unbekannte Filterparameter lieferten 0 Treffer). */
  searchUrl(start: number, region?: string): string {
    const p = new URLSearchParams({ c: String(config.subito.categoryId), t: 's', lim: String(config.subito.pageSize), start: String(start), sort: 'datedesc' });
    if (region) p.set('r', region);
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
