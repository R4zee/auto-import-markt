import { config, type OlxSite } from '../config.js';
import { marketForCountry } from '../domain/markets.js';
import type { Listing } from '../domain/types.js';
import { defaultPartnerFor } from '../seed/partners.js';
import { encarDrive } from './encar.js';
import { getJson, num, sleep, str } from './http.js';
import { listingId, normalizeFuel, normalizeTransmission, type MarketProvider, type ProviderResult } from './types.js';

/**
 * OLX (Polen, Rumänien, Bulgarien, Portugal) – öffentlicher Frontend-Endpunkt der OLX-Seiten, kein Key:
 *
 *   GET https://www.olx.pl/api/v1/offers/?category_id=<Pkw-Kategorie>&offset=0&limit=40&sort_by=created_at:desc
 *
 * Antwort { data: Offer[], metadata: { total_elements, visible_total_count }, links: { next: { href } } }.
 * Offer: id, url, title, created_time, description, business, params[{ key, name, type, value{ key, label | value, currency } }],
 * location{ city{ name }, region{ name } }, photos[{ link (mit Platzhalter ";s={width}x{height}") }], category{ id }.
 * (Struktur aus dem öffentlichen Wrapper-Paket `olx-api-wrapper`; Parameter-Schlüssel je Land unterschiedlich –
 * der Adapter sucht deshalb über Synonymlisten.)
 *
 * Auf OLX ist die Marke eine Unterkategorie (category.id), kein Parameter. Der Adapter liest sie über
 * /api/v1/offers/metadata/breadcrumbs/?category_id=… (einmal je Kategorie und Lauf) und fällt sonst auf den Titel zurück.
 * Undokumentierter Endpunkt → Grauzone wie Encar; darum je Land schaltbar (OLX_SITES), gedrosselt (OLX_DELAY_MS).
 */
export interface OlxParamValue { key?: string | string[] | null; label?: string | null; value?: number | string | null; currency?: string | null }
export interface OlxParam { key: string; name?: string; type?: string; value?: OlxParamValue | null }
export interface OlxOffer {
  id: number | string; url?: string; title?: string; created_time?: string; last_refresh_time?: string; description?: string; business?: boolean;
  params?: OlxParam[];
  location?: { city?: { name?: string }; region?: { name?: string }; district?: { name?: string } };
  photos?: Array<{ link?: string; width?: number; height?: number }>;
  category?: { id?: number; type?: string };
  status?: string;
}
export interface OlxOffersResponse { data?: OlxOffer[]; metadata?: { total_elements?: number; visible_total_count?: number }; links?: { next?: { href?: string } } }

const KEYS = {
  make: ['make', 'marka', 'marca', 'brand', 'car_brand', 'manufacturer'],
  model: ['model', 'modelo', 'car_model'],
  year: ['year', 'rok_produkcji', 'an', 'ano', 'godina', 'year_of_production'],
  km: ['milage', 'mileage', 'przebieg', 'rulaj', 'probeg', 'quilometros', 'kilometros', 'km'],
  fuel: ['petrol', 'fuel', 'paliwo', 'combustibil', 'gorivo', 'combustivel', 'fuel_type'],
  transmission: ['transmission', 'skrzynia', 'cutie_de_viteze', 'skorosti', 'caixa', 'gearbox'],
  engine: ['enginesize', 'engine_size', 'pojemnosc', 'capacitate_motor', 'cilindrada', 'engine_capacity', 'motor'],
  body: ['car_body', 'body', 'caroserie', 'tip_caroserie'],
  drive: ['drive', 'naped', 'tractiune', 'tracao'],
  condition: ['condition', 'stan', 'stare', 'estado'],
};

const KNOWN_MAKES = ['Alfa Romeo', 'Aston Martin', 'Audi', 'Bentley', 'BMW', 'Cadillac', 'Chevrolet', 'Chrysler', 'Citroën', 'Citroen', 'Cupra', 'Dacia', 'Dodge', 'DS', 'Ferrari', 'Fiat', 'Ford', 'Genesis', 'Honda', 'Hyundai', 'Infiniti', 'Jaguar', 'Jeep', 'Kia', 'Lamborghini', 'Lancia', 'Land Rover', 'Lexus', 'Lincoln', 'Maserati', 'Mazda', 'McLaren', 'Mercedes-Benz', 'Mercedes', 'MG', 'Mini', 'Mitsubishi', 'Nissan', 'Opel', 'Peugeot', 'Porsche', 'Renault', 'Rolls-Royce', 'Saab', 'Seat', 'Škoda', 'Skoda', 'Smart', 'SsangYong', 'Subaru', 'Suzuki', 'Tesla', 'Toyota', 'Volkswagen', 'VW', 'Volvo', 'BYD', 'Polestar', 'Lynk & Co', 'Abarth', 'Daewoo', 'Daihatsu', 'Isuzu', 'Iveco', 'Lada', 'Rover', 'Tata'];

function param(o: OlxOffer, keys: string[]): OlxParam | undefined {
  const ps = o.params ?? [];
  return ps.find((p) => keys.includes(p.key.toLowerCase())) ?? ps.find((p) => keys.some((k) => p.key.toLowerCase().includes(k)));
}
function paramText(o: OlxOffer, keys: string[]): string {
  const p = param(o, keys);
  const v = p?.value;
  if (!v) return '';
  return str(v.label ?? (Array.isArray(v.key) ? v.key.join(' ') : v.key) ?? v.value ?? '');
}
function paramNum(o: OlxOffer, keys: string[]): number | null {
  const p = param(o, keys);
  const v = p?.value;
  if (!v) return null;
  return num(v.value) ?? num(Array.isArray(v.key) ? v.key[0] : v.key) ?? num(v.label);
}

/** Marke aus Titel: längster bekannter Markenname am Anfang, sonst erstes Wort. */
export function makeFromTitle(title: string): string {
  const t = title.trim();
  const hit = KNOWN_MAKES.filter((m) => t.toLowerCase().startsWith(m.toLowerCase() + ' ') || t.toLowerCase() === m.toLowerCase()).sort((a, b) => b.length - a.length)[0];
  if (hit) return hit === 'VW' ? 'Volkswagen' : hit === 'Mercedes' ? 'Mercedes-Benz' : hit === 'Citroen' ? 'Citroën' : hit === 'Skoda' ? 'Škoda' : hit;
  return t.split(/\s+/)[0] ?? '';
}

export function olxPhoto(link: string | undefined): string | null {
  if (!link) return null;
  return link.replace('{width}x{height}', '1280x960').replace('{width}', '1280').replace('{height}', '960');
}

export function mapOlxOffer(o: OlxOffer, site: OlxSite, fetchedAt: string, makeByCategory: Map<number, string> = new Map()): Listing | null {
  const externalId = str(o.id);
  const title = str(o.title).trim();
  const priceParam = (o.params ?? []).find((p) => p.key === 'price');
  const price = num(priceParam?.value?.value) ?? num(priceParam?.value?.label);
  const currency = str(priceParam?.value?.currency || site.currency).toUpperCase();
  const year = paramNum(o, KEYS.year);
  const market = marketForCountry(site.country);
  if (!externalId || !title || !price || !year || !market) return null;
  if (o.status && o.status !== 'active') return null;
  // Unfall-/beschädigte Fahrzeuge aussortieren – Schlüssel ("damaged") vor Beschriftung ("Uszkodzony"; "Nieuszkodzony" = unbeschädigt)
  const condParam = param(o, KEYS.condition);
  const condKey = str(Array.isArray(condParam?.value?.key) ? condParam?.value?.key[0] : condParam?.value?.key).toLowerCase();
  const condLabel = str(condParam?.value?.label).toLowerCase();
  const damaged = /^(damaged|uszkodzony|avariat|повреден|acidentado|salvage)$/.test(condKey)
    || (!condKey && /uszkodzon|damaged|avariat|повреден|acidentad|salvage/.test(condLabel) && !/^(nie|not|ne|non|não|nao|не)/.test(condLabel));
  if (damaged) return null;

  const categoryId = num(o.category?.id);
  let make = paramText(o, KEYS.make) || (categoryId != null ? makeByCategory.get(categoryId) : '') || makeFromTitle(title);
  if (make.toLowerCase() === 'inne' || make.toLowerCase() === 'other' || make.toLowerCase() === 'altele') make = makeFromTitle(title);
  const modelRaw = paramText(o, KEYS.model);
  const model = modelRaw && !/^(inn[ey]|other|altele|outro)$/i.test(modelRaw) ? modelRaw : title.replace(new RegExp(`^${make.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '').split(/[\s,·|/-]+/)[0] || title;
  const fuelText = paramText(o, KEYS.fuel);
  const fuel = /elektr|electric|електр|elétr|eletr/i.test(fuelText) && !/hybr|hibr/i.test(fuelText) ? 'Electric' : /hybr|hibr|хибр/i.test(fuelText) ? 'Hybrid' : /diesel|дизел|gasóleo|gasoleo/i.test(fuelText) ? 'Diesel' : normalizeFuel(fuelText);
  const transText = paramText(o, KEYS.transmission);
  const transmission = /manual|manuell|ręczn|reczn|manuală|manuala|ръчн/i.test(transText) ? 'Manual' : normalizeTransmission(transText || 'automatic');
  const engineRaw = paramText(o, KEYS.engine);
  const ccmRaw = num(engineRaw.replace(/\s/g, ''));
  const ccm = fuel === 'Electric' ? null : ccmRaw && ccmRaw > 400 && ccmRaw < 9000 ? Math.round(ccmRaw) : null;
  const driveText = paramText(o, KEYS.drive);
  const drive = /4x4|awd|4wd|quattro|xdrive|4matic|integral|wszystkie|4 ?koła|4 ?kola/i.test(`${driveText} ${title}`) ? 'AWD' : encarDrive(title, make);
  const photos = (o.photos ?? []).map((p) => olxPhoto(p.link)).filter((p): p is string => !!p);
  const km = Math.round(paramNum(o, KEYS.km) ?? 0);
  const trimParts = [modelRaw ? title.replace(new RegExp(`^${make.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '').replace(new RegExp(`^${modelRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '').trim() : '', paramText(o, KEYS.body)].filter(Boolean);

  return {
    id: listingId(`olx-${site.country}`, externalId),
    source: `olx-${site.country}`,
    externalId,
    market,
    country: site.country,
    location: str(o.location?.city?.name) || str(o.location?.region?.name),
    offerType: 'fixed',
    url: str(o.url) || null,
    year,
    make,
    model,
    trim: trimParts.join(' · ').slice(0, 120),
    km,
    engine: fuel === 'Electric' ? 'EV' : ccm ? `${(ccm / 1000).toFixed(1)} L` : '',
    engineCcm: ccm,
    co2Gkm: null,
    transmission,
    drive,
    fuel,
    price,
    currency,
    steering: 'LHD',
    auction: null,
    coc: true, // EU-Fahrzeug im freien Verkehr
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

const OLX_LANG: Record<string, string> = { pl: 'pl-PL,pl;q=0.9,en;q=0.8', ro: 'ro-RO,ro;q=0.9,en;q=0.8', bg: 'bg-BG,bg;q=0.9,en;q=0.8', pt: 'pt-PT,pt;q=0.9,en;q=0.8' };

/** Header-Satz, wie ihn der Browser auf der OLX-Seite selbst mitschickt (WAF-Freigabe). */
export function olxHeaders(site?: OlxSite, variant: 'browser' | 'minimal' | 'json' = 'browser'): Record<string, string> {
  const origin = site ? `https://${site.host}` : 'https://www.olx.pl';
  if (variant === 'minimal') return { Accept: 'application/json' };
  if (variant === 'json') return { Accept: 'application/json', 'User-Agent': config.europe.userAgent, 'Accept-Language': OLX_LANG[site?.country ?? 'pl'] ?? 'en' };
  return {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': OLX_LANG[site?.country ?? 'pl'] ?? 'en',
    'User-Agent': config.europe.userAgent,
    Referer: `${origin}/`,
    Origin: origin,
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
    'x-client': 'DESKTOP',
  };
}

export class OlxProvider implements MarketProvider {
  readonly id = 'olx';
  readonly label = 'OLX (PL/RO/BG/PT, Frontend-Endpunkt)';

  enabled(): boolean {
    return config.olx.sites.some((s) => s.enabled && s.categoryId != null);
  }

  /** Browser-nahe Header: die OLX-Seiten sitzen hinter CloudFront/WAF und lehnen nackte Clients mit 403 ab */
  http(site?: OlxSite) {
    return { headers: olxHeaders(site), proxyUrl: config.europe.proxyUrl || undefined, timeoutMs: 30000 };
  }

  /**
   * Filterparameter (filter_float_price:from, filter_float_year:from) beantwortet der WAF mit 403 (Probe 14.09.2026),
   * die ungefilterte Liste mit 200 → standardmäßig ohne Serverfilter, Mindestpreis/-baujahr werden nach dem Abruf geprüft.
   */
  offersUrl(site: OlxSite, offset: number, withFilters = config.olx.serverFilters): string {
    const p = new URLSearchParams({ category_id: String(site.categoryId), offset: String(offset), limit: String(config.olx.pageSize), sort_by: 'created_at:desc' });
    if (withFilters && config.olx.minPriceLocal > 0) p.set('filter_float_price:from', String(config.olx.minPriceLocal));
    if (withFilters && config.olx.minYear > 0) p.set('filter_float_year:from', String(config.olx.minYear));
    return `https://${site.host}/api/v1/offers/?${p}`;
  }

  async makeForCategory(site: OlxSite, categoryId: number, cache: Map<number, string>): Promise<void> {
    if (cache.has(categoryId)) return;
    try {
      const json = await getJson<{ data?: Array<{ label?: string; name?: string; category_id?: number; id?: number }> }>(`https://${site.host}/api/v1/offers/metadata/breadcrumbs/?category_id=${categoryId}`, { ...this.http(site), retries: 0 });
      const crumbs = json.data ?? [];
      const own = crumbs.find((c) => num(c.category_id ?? c.id) === categoryId) ?? crumbs[crumbs.length - 1];
      cache.set(categoryId, str(own?.label ?? own?.name));
    } catch {
      cache.set(categoryId, '');
    }
  }

  async fetchSite(site: OlxSite, fetchedAt: string, warnings: string[]): Promise<Listing[]> {
    const listings: Listing[] = [];
    const makeByCategory = new Map<number, string>();
    let offset = 0;
    for (let page = 0; page < config.olx.pages; page++) {
      const json = await getJson<OlxOffersResponse>(this.offersUrl(site, offset), this.http(site));
      const offers = json.data ?? [];
      if (!offers.length) break;
      // Marken je (Unter-)Kategorie einmal nachschlagen – höchstens ein Aufruf je Kategorie und Lauf
      for (const o of offers) {
        const cid = num(o.category?.id);
        if (cid != null && cid !== site.categoryId && !makeByCategory.has(cid)) await this.makeForCategory(site, cid, makeByCategory);
      }
      for (const o of offers) {
        const l = mapOlxOffer(o, site, fetchedAt, makeByCategory);
        if (l && l.price >= config.olx.minPriceLocal && l.year >= config.olx.minYear) listings.push(l);
      }
      offset += offers.length;
      if (!json.links?.next?.href || offers.length < config.olx.pageSize) break;
      await sleep(config.olx.delayMs);
    }
    warnings.push(`${site.country.toUpperCase()} (${site.host}): ${listings.length} Inserate`);
    return listings;
  }

  async fetchAll(): Promise<ProviderResult> {
    const fetchedAt = new Date().toISOString();
    const listings: Listing[] = [];
    const warnings: string[] = [];
    let failed = 0;
    const sites = config.olx.sites.filter((s) => s.enabled && s.categoryId != null);
    for (const site of sites) {
      try {
        listings.push(...(await this.fetchSite(site, fetchedAt, warnings)));
      } catch (e) {
        failed++;
        warnings.push(`${site.country.toUpperCase()} (${site.host}): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (sites.length && failed === sites.length) throw new Error(`OLX: alle Seiten fehlgeschlagen – ${warnings.slice(0, 2).join(' | ')}`);
    // OLX liefert nur die neuesten N Seiten je Lauf → kein vollständiger Bestand, nichts deaktivieren
    return { listings, complete: false, warnings };
  }
}
