import { config, type OlxSite } from '../config.js';
import { marketForCountry } from '../domain/markets.js';
import type { Listing } from '../domain/types.js';
import { defaultPartnerFor } from '../seed/partners.js';
import { encarDrive } from './encar.js';
import { HttpError, num, robustFetch, sleep, str } from './http.js';
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
export type OlxFilterLevel = 'both' | 'price' | 'none';

/**
 * Parameter-Schlüssel je Land (Live-Proben 14.09.2026):
 *   PL: model, year, milage, petrol, transmission, enginesize, enginepower, drive, righthanddrive, car_body, condition
 *   RO: model, year, rulaj_pana, petrol, gearbox, enginesize, engine_power, car_body, state
 *   PT: modelo, year, quilometros, combustivel, gearbox, engine_power, body_type, condicao
 *   BG: model, auto_make_year, auto_mileage, auto_engine_type, auto_transmission_type, horsepower, coupe, technical_condition
 * Zuerst exakter Schlüssel, dann Wortsegment (getrennt durch _ oder -), zuletzt Teilstring ab 5 Zeichen –
 * sonst fand "an" (RO Baujahr) in "eurostandard" und "make" in "auto_make_year".
 */
const KEYS = {
  make: ['make', 'marka', 'marca', 'brand', 'car_brand', 'manufacturer'],
  model: ['model', 'modelo', 'car_model'],
  year: ['year', 'auto_make_year', 'rok_produkcji', 'an', 'ano', 'godina', 'year_of_production'],
  km: ['milage', 'mileage', 'auto_mileage', 'przebieg', 'rulaj', 'rulaj_pana', 'probeg', 'quilometros', 'kilometros', 'km'],
  fuel: ['petrol', 'fuel', 'auto_engine_type', 'engine_type', 'paliwo', 'combustibil', 'gorivo', 'dvigatel', 'combustivel', 'fuel_type'],
  transmission: ['transmission', 'auto_transmission_type', 'skrzynia', 'cutie_de_viteze', 'skorosti', 'caixa', 'gearbox'],
  engine: ['enginesize', 'engine_size', 'pojemnosc', 'capacitate_motor', 'cilindrada', 'engine_capacity', 'motor'],
  body: ['car_body', 'body_type', 'body', 'caroserie', 'tip_caroserie', 'coupe'],
  drive: ['drive', 'naped', 'tractiune', 'tracao'],
  condition: ['condition', 'technical_condition', 'stan', 'stare', 'state', 'estado', 'condicao', 'sastoyanie'],
  steering: ['righthanddrive', 'steering', 'steering_wheel', 'kierownica', 'volan', 'volante'],
};

const KNOWN_MAKES = ['Alfa Romeo', 'Aston Martin', 'Audi', 'Bentley', 'BMW', 'Cadillac', 'Chevrolet', 'Chrysler', 'Citroën', 'Citroen', 'Cupra', 'Dacia', 'Dodge', 'DS', 'Ferrari', 'Fiat', 'Ford', 'Genesis', 'Honda', 'Hyundai', 'Infiniti', 'Jaguar', 'Jeep', 'Kia', 'Lamborghini', 'Lancia', 'Land Rover', 'Lexus', 'Lincoln', 'Maserati', 'Mazda', 'McLaren', 'Mercedes-Benz', 'Mercedes', 'MG', 'Mini', 'Mitsubishi', 'Nissan', 'Opel', 'Peugeot', 'Porsche', 'Renault', 'Rolls-Royce', 'Saab', 'Seat', 'Škoda', 'Skoda', 'Smart', 'SsangYong', 'Subaru', 'Suzuki', 'Tesla', 'Toyota', 'Volkswagen', 'VW', 'Volvo', 'BYD', 'Polestar', 'Lynk & Co', 'Abarth', 'Daewoo', 'Daihatsu', 'Isuzu', 'Iveco', 'Lada', 'Rover', 'Tata'];

function param(o: OlxOffer, keys: string[]): OlxParam | undefined {
  const ps = o.params ?? [];
  const exact = ps.find((p) => keys.includes(p.key.toLowerCase()));
  if (exact) return exact;
  const bySegment = ps.find((p) => { const segs = p.key.toLowerCase().split(/[_-]+/); return keys.some((k) => segs.includes(k)); });
  if (bySegment) return bySegment;
  return ps.find((p) => keys.some((k) => k.length >= 5 && p.key.toLowerCase().includes(k)));
}
function paramText(o: OlxOffer, keys: string[]): string {
  const p = param(o, keys);
  const v = p?.value;
  if (!v) return '';
  return str(v.label ?? (Array.isArray(v.key) ? v.key.join(' ') : v.key) ?? v.value ?? '');
}
function paramKey(o: OlxOffer, keys: string[]): string {
  const v = param(o, keys)?.value;
  if (!v) return '';
  return str(Array.isArray(v.key) ? v.key[0] : v.key).toLowerCase();
}
function paramNum(o: OlxOffer, keys: string[]): number | null {
  const p = param(o, keys);
  const v = p?.value;
  if (!v) return null;
  return num(v.value) ?? num(Array.isArray(v.key) ? v.key[0] : v.key) ?? num(v.label);
}

/** Verkäufer-Floskeln am Titelanfang (pl/ro/bg/pt/it/cz) */
const TITLE_PREFIX = /^(?:(?:sprzedam|sprzedaż|na sprzedaż|okazja|pilnie|polecam|super|zamiana|vand|vând|vanzare|vânzare|de vânzare|de vanzare|urgent|ocazie|продавам|продава се|спешно|vendo|vende-se|vende se|oportunidade|prodám|prodam|prodej)\b[\s:,\-–!]*)+/iu;

const CANON: Record<string, string> = { VW: 'Volkswagen', Mercedes: 'Mercedes-Benz', Citroen: 'Citroën', Skoda: 'Škoda' };

/** Marke aus Titel: Floskeln abschneiden, dann frühester bekannter Markenname im Titel, sonst erstes Wort. */
export function makeFromTitle(title: string): string {
  const t = title.trim().replace(TITLE_PREFIX, '').trim();
  const lower = t.toLowerCase();
  let best: { make: string; at: number } | null = null;
  for (const m of KNOWN_MAKES) {
    const re = new RegExp(`(^|[^\\p{L}])${m.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'iu');
    const hit = re.exec(lower);
    if (!hit) continue;
    const at = hit.index + hit[1].length;
    if (!best || at < best.at || (at === best.at && m.length > best.make.length)) best = { make: m, at };
  }
  if (best) return CANON[best.make] ?? best.make;
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
  const priceRaw = num(priceParam?.value?.value) ?? num(priceParam?.value?.label);
  const price = priceRaw == null ? null : Math.round(priceRaw); // olx.ro liefert umgerechnete Werte wie 37990.01
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

  // Marke: Unterkategorie (Breadcrumb) vor Parameter vor Titel – auf allen vier Seiten ist die Marke eine Unterkategorie
  const categoryId = num(o.category?.id);
  let make = (categoryId != null ? makeByCategory.get(categoryId) : '') || paramText(o, KEYS.make) || makeFromTitle(title);
  if (make.toLowerCase() === 'inne' || make.toLowerCase() === 'other' || make.toLowerCase() === 'altele') make = makeFromTitle(title);
  // Platzhalter-Modelle ("inny" = Pozostałe Land Rover, "other", "altele", "outros", "drugi") → Modell aus dem Titel
  const modelKey = paramKey(o, KEYS.model);
  const modelLabel = paramText(o, KEYS.model);
  const modelRaw = modelLabel && !/^(inn[ey]|other|others|altele|alte|outro|outros|drugi|drugo|inne)$/i.test(modelKey) && !/^(inn[ey]|other|altele|outro)$/i.test(modelLabel) ? modelLabel : '';
  const model = modelRaw || title.replace(TITLE_PREFIX, '').replace(new RegExp(`^${make.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '').split(/[\s,·|/]+/).filter((w) => !/^\d{4}$/.test(w))[0] || title;
  // olx.pl (Live 14.09.2026): petrol.key = petrol|diesel|lpg|cng|hybrid|plug-in-hybrid|electric; Beschriftung z. B. "CNG i Hybryda"
  const fuelKey = paramKey(o, KEYS.fuel);
  const fuelText = `${fuelKey} ${paramText(o, KEYS.fuel)}`;
  const fuel = /^electric/.test(fuelKey) || (/elektr|electric|електр|elétr|eletr/i.test(fuelText) && !/hybr|hibr/i.test(fuelText)) ? 'Electric'
    : /hybr|hibr|хибр|plug/i.test(fuelText) ? 'Hybrid'
    : /diesel|дизел|gasóleo|gasoleo/i.test(fuelText) ? 'Diesel'
    : normalizeFuel(fuelText); // petrol, lpg, cng → Petrol
  const transText = `${paramKey(o, KEYS.transmission)} ${paramText(o, KEYS.transmission)}`;
  const transmission = /manual|manuell|ręczn|reczn|manuală|manuala|ръчн/i.test(transText) ? 'Manual' : normalizeTransmission(transText || 'automatic');
  const engineRaw = paramKey(o, KEYS.engine) || paramText(o, KEYS.engine);
  const ccmRaw = num(engineRaw.replace(/\s/g, ''));
  const ccm = fuel === 'Electric' ? null : ccmRaw && ccmRaw > 400 && ccmRaw < 9000 ? Math.round(ccmRaw) : null;
  // drive.key = front-wheel | rear-wheel | all-wheel (olx.pl "Na przednie koła" / "Na tylne koła" / "4x4 (stały)")
  const driveKey = paramKey(o, KEYS.drive);
  const driveText = `${driveKey} ${paramText(o, KEYS.drive)}`;
  const drive = /all-wheel|4x4|awd|4wd|quattro|xdrive|4matic|integral|wszystkie|4 ?koła|4 ?kola/i.test(`${driveText} ${title}`) ? 'AWD'
    : /front|przedni|față|fata|предн|dianteir/i.test(driveText) ? 'FWD'
    : /rear|tyln|spate|задн|traseir/i.test(driveText) ? 'RWD'
    : encarDrive(title, make);
  // Lenkung: olx.pl "righthanddrive" – Beschriftung "po lewej" (links) bzw. "po prawej" (rechts)
  const steeringText = `${paramKey(o, KEYS.steering)} ${paramText(o, KEYS.steering)}`.toLowerCase();
  const steering: Listing['steering'] = /\brhd\b|prawej|right|dreapta|дясно|direita/.test(steeringText) && !/\blhd\b|lewej|left|stânga|stanga|ляво|esquerda/.test(steeringText) ? 'RHD' : 'LHD';
  const photos = (o.photos ?? []).map((p) => olxPhoto(p.link)).filter((p): p is string => !!p);
  const km = Math.round(paramNum(o, KEYS.km) ?? 0);
  // Ausstattungszeile aus dem Titel: Marke und Modell (auch "RAV4" vs. "RAV-4") vorne entfernen, Verkäufer-Floskeln kürzen
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const loose = (s: string) => s.split('').filter((c) => /[\p{L}\p{N}]/u.test(c)).map((c) => `${esc(c)}[\\s\\-\\.]*`).join('');
  // Marke und Modell werden beim ersten Vorkommen entfernt (auch nach Emoji oder Floskel), sonst bliebe "Nissan Qashqai 1.6 …" doppelt
  let rest = title.trim().replace(TITLE_PREFIX, '').replace(new RegExp(`(^|[^\\p{L}])${loose(make)}\\s*`, 'iu'), '$1');
  if (modelRaw) rest = rest.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${loose(modelRaw)}(?![\\p{L}\\p{N}])\\s*`, 'iu'), '$1');
  rest = rest.replace(/^[,\-–·|!\s]+/, '').replace(/\s*[|!]+\s*/g, ' · ').trim().slice(0, 80);
  const trimParts = [rest, paramText(o, KEYS.body)].filter(Boolean);

  return {
    id: listingId(`olx-${site.country}`, externalId),
    source: `olx-${site.country}`,
    externalId,
    market,
    country: site.country,
    location: (str(o.location?.city?.name) || str(o.location?.region?.name)).replace(/^(гр\.|с\.|обл\.|Област)\s*/i, '').trim(),
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
    steering, // Rechtslenker verwirft der Sync
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

  /**
   * Abruf mit Chrome-ähnlichem TLS-Profil. Befund der Proben 14.09.2026 (CloudFront-WAF): Header, URL und
   * Verbindungs-Wiederverwendung waren egal – der WAF blockt Nodes Standard-TLS-ClientHello (403 in ~10 ms am Edge).
   * Mit Chrome-Cipher-Reihenfolge (oder nur TLS 1.3) kam jede von 15 Anfragen durch. Die 200er im Standard-Pool direkt
   * nach einem 403 waren wiederaufgenommene TLS-Sitzungen (anderer Fingerprint). Zur Sicherheit bis zu `attempts`
   * Versuche, bei 403 ohne Pause.
   */
  async get<T>(url: string, site: OlxSite, attempts = 4): Promise<T> {
    const variants: Array<'browser' | 'json'> = ['browser', 'json'];
    let last: HttpError | Error | null = null;
    for (let i = 0; i < attempts; i++) {
      const headers = olxHeaders(site, variants[i % variants.length]);
      try {
        const res = await robustFetch(url, { headers, timeoutMs: 30000, proxyUrl: config.europe.proxyUrl || undefined, nodeOnly: true, tls: config.olx.tlsProfile, fresh: config.olx.freshConnection });
        if (res.ok) return (await res.json()) as T;
        const body = await res.text().catch(() => '');
        last = new HttpError(res.status, url, body.replace(/\s+/g, ' ').slice(0, 120), null);
        if (res.status !== 403 && res.status !== 429 && res.status < 500) throw last;
        if (res.status === 429 || res.status >= 500) await sleep(1000 + i * 500);
      } catch (e) {
        if (e instanceof HttpError && e.status !== 403 && e.status !== 429 && e.status < 500) throw e;
        last = e instanceof Error ? e : new Error(String(e));
        await sleep(300);
      }
    }
    throw last ?? new Error(`OLX: keine Antwort (${url})`);
  }

  minPrice(site: OlxSite): number {
    return config.olx.minPriceOverride ?? site.minPrice;
  }

  /**
   * Serverfilter: Preis und Baujahr (PL/RO/PT bestätigt, Probe 14.09.2026). olx.bg kennt den Baujahrfilter nicht
   * (HTTP 400 „Request validation“), den Preisfilter schon → fetchOffers stuft ab: beide → nur Preis → keiner.
   * Nach dem Abruf wird ohnehin geprüft.
   */
  offersUrl(site: OlxSite, offset: number, filters: OlxFilterLevel = config.olx.serverFilters ? 'both' : 'none'): string {
    const p = new URLSearchParams({ category_id: String(site.categoryId), offset: String(offset), limit: String(config.olx.pageSize), sort_by: 'created_at:desc' });
    if (filters !== 'none' && this.minPrice(site) > 0) p.set('filter_float_price:from', String(this.minPrice(site)));
    if (filters === 'both' && config.olx.minYear > 0) p.set('filter_float_year:from', String(config.olx.minYear));
    return `https://${site.host}/api/v1/offers/?${p}`;
  }

  /** Liste laden; bei 400 (Seite kennt einen Filterparameter nicht) mit weniger Serverfiltern wiederholen. */
  async fetchOffers(site: OlxSite, offset: number, state: { filters: OlxFilterLevel }, warnings?: string[]): Promise<OlxOffersResponse> {
    for (;;) {
      try {
        return await this.get<OlxOffersResponse>(this.offersUrl(site, offset, state.filters), site);
      } catch (e) {
        if (state.filters !== 'none' && e instanceof HttpError && e.status === 400) {
          state.filters = state.filters === 'both' ? 'price' : 'none';
          warnings?.push(`${site.country.toUpperCase()}: Serverfilter nicht akzeptiert (HTTP 400) → ${state.filters === 'price' ? 'nur Preisfilter' : 'ohne Serverfilter'}, Rest nach dem Abruf`);
          continue;
        }
        throw e;
      }
    }
  }

  /** Breadcrumb-Antwort tolerant lesen: `data` kann Liste oder Objekt sein – alle label/name-Werte in Reihenfolge. */
  static breadcrumbLabels(json: unknown): string[] {
    const out: string[] = [];
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        const label = o.label ?? o.name ?? o.title;
        if (typeof label === 'string' && label.trim()) out.push(label.trim());
        for (const [k, val] of Object.entries(o)) if (k !== 'label' && k !== 'name' && k !== 'title') walk(val);
      }
    };
    walk(json);
    return out;
  }

  async makeForCategory(site: OlxSite, categoryId: number, cache: Map<number, string>): Promise<void> {
    if (cache.has(categoryId)) return;
    try {
      const json = await this.get<unknown>(`https://${site.host}/api/v1/offers/metadata/breadcrumbs/?category_id=${categoryId}`, site, 3);
      const labels = OlxProvider.breadcrumbLabels(json);
      // letztes Glied = die Unterkategorie selbst (Marke), z. B. "Motoryzacja › Samochody osobowe › Dodge"
      cache.set(categoryId, labels[labels.length - 1] ?? '');
    } catch {
      cache.set(categoryId, '');
    }
  }

  async fetchSite(site: OlxSite, fetchedAt: string, warnings: string[]): Promise<Listing[]> {
    const listings: Listing[] = [];
    const seen = new Set<string>();
    const makeByCategory = new Map<number, string>();
    const state: { filters: OlxFilterLevel } = { filters: config.olx.serverFilters ? 'both' : 'none' };
    let offset = 0;
    for (let page = 0; page < config.olx.pages; page++) {
      const json = await this.fetchOffers(site, offset, state, warnings);
      const offers = json.data ?? [];
      if (!offers.length) break;
      // Marken je (Unter-)Kategorie einmal nachschlagen – höchstens ein Aufruf je Kategorie und Lauf
      for (const o of offers) {
        const cid = num(o.category?.id);
        if (cid != null && cid !== site.categoryId && !makeByCategory.has(cid)) await this.makeForCategory(site, cid, makeByCategory);
      }
      for (const o of offers) {
        const l = mapOlxOffer(o, site, fetchedAt, makeByCategory);
        // beworbene Anzeigen erscheinen auf mehreren Seiten erneut → nur einmal aufnehmen
        if (l && !seen.has(l.id) && l.price >= this.minPrice(site) && l.year >= config.olx.minYear) { seen.add(l.id); listings.push(l); }
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
