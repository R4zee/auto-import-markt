import { isAbsolute, resolve } from 'node:path';

const env = process.env;
/**
 * Paket-Wurzel (backend/), damit relative Pfade unabhängig vom Startverzeichnis sind.
 * Im Vercel-Bundle ist import.meta.dirname ggf. nicht gesetzt → Fallback auf cwd.
 */
const PKG_ROOT = typeof import.meta.dirname === 'string' ? resolve(import.meta.dirname, '..') : resolve(process.cwd(), 'backend');

export const isServerless = ['1', 'true'].includes((env.VERCEL ?? '').toLowerCase());

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && value !== undefined && value !== '' ? n : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Datenbank-URL für @libsql/client:
 *  - Turso/Vercel: TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN), alternativ DATABASE_URL
 *  - lokal: DATABASE_PATH (Datei relativ zu backend/) oder ':memory:'
 */
function databaseUrl(): string {
  const remote = env.TURSO_DATABASE_URL || env.DATABASE_URL;
  if (remote) return remote;
  // Ohne gehostete Datenbank auf Vercel: In-Memory, damit die API antwortet und /api/health den Mangel meldet
  if (isServerless) return ':memory:';
  const p = env.DATABASE_PATH ?? './data/aim.sqlite';
  if (p === ':memory:') return ':memory:';
  const abs = isAbsolute(p) ? p : resolve(PKG_ROOT, p);
  return `file:${abs.replace(/\\/g, '/')}`;
}

/** true, wenn auf Vercel keine Turso-/DATABASE_URL gesetzt ist (Daten gehen bei jedem Kaltstart verloren) */
export const databaseMissing = isServerless && !(env.TURSO_DATABASE_URL || env.DATABASE_URL);

export interface PartnerFeedConfig {
  /** Quellen-Schlüssel (a–z, 0–9, Bindestrich), z. B. "feed-carpathia" */
  id: string;
  label: string;
  url: string;
  /** "Header-Name: Wert", z. B. "Authorization: Bearer …" */
  authHeader: string;
  /** Feldzuordnung als JSON-String (siehe providers/feed.ts) */
  mapping: string;
  /** Vorgaben, falls der Feed sie nicht liefert */
  market: string;
  country: string;
  partnerId: string;
}

/**
 * PARTNER_FEEDS: JSON-Array von Feeds, z. B.
 * [{"id":"carpathia","label":"Carpathia (RO)","url":"https://…/stock.json","country":"ro",
 *   "mapping":{"items":"cars","id":"id","year":"year","make":"brand","model":"model","km":"mileage","price":"price_eur","photos":"images","url":"link"}}]
 * `mapping` darf Objekt oder String sein. Der bisherige Einzel-Feed (JP_FEED_URL/JP_FEED_MAPPING) wird als "jpfeed" angehängt.
 */
function partnerFeeds(): PartnerFeedConfig[] {
  const out: PartnerFeedConfig[] = [];
  const raw = (env.PARTNER_FEEDS ?? '').trim();
  if (raw) {
    let arr: unknown;
    try { arr = JSON.parse(raw); } catch (e) { throw new Error(`PARTNER_FEEDS ist kein gültiges JSON: ${e instanceof Error ? e.message : String(e)}`); }
    if (!Array.isArray(arr)) throw new Error('PARTNER_FEEDS muss ein JSON-Array sein');
    for (const f of arr as Array<Record<string, unknown>>) {
      const id = String(f.id ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
      if (!id) throw new Error('PARTNER_FEEDS: jeder Feed braucht eine id');
      out.push({
        id: id.startsWith('feed-') ? id : `feed-${id}`,
        label: String(f.label ?? `Partner-Feed ${id}`),
        url: String(f.url ?? ''),
        authHeader: String(f.authHeader ?? ''),
        mapping: typeof f.mapping === 'string' ? f.mapping : f.mapping ? JSON.stringify(f.mapping) : '',
        market: String(f.market ?? ''),
        country: String(f.country ?? '').toLowerCase(),
        partnerId: String(f.partnerId ?? ''),
      });
    }
  }
  if (env.JP_FEED_URL || env.JP_FEED_MAPPING) {
    out.push({ id: 'jpfeed', label: 'Partner-Feed Japan', url: env.JP_FEED_URL ?? '', authHeader: env.JP_FEED_AUTH_HEADER ?? '', mapping: env.JP_FEED_MAPPING ?? '', market: 'JP', country: 'jp', partnerId: '' });
  }
  return out;
}

export interface OlxSite {
  /** ISO-2 klein, wird Teil der Quelle (olx-pl) und bestimmt den Markt */
  country: string;
  host: string;
  /** Pkw-Kategorie der jeweiligen OLX-Seite (null = noch nicht ermittelt → Seite bleibt aus) */
  categoryId: number | null;
  /** Rückfall-Währung, falls das Inserat keine nennt (olx.ro und olx.pt inserieren überwiegend in EUR) */
  currency: string;
  /** Mindestpreis in der dominierenden Inseratswährung der Seite (PL: PLN, RO: EUR, BG: BGN, PT: EUR) */
  minPrice: number;
  enabled: boolean;
}

/**
 * OLX_SITES: JSON-Array, überschreibt/ergänzt die Vorgaben, z. B.
 * [{"country":"pl","enabled":false}] – Pkw-Kategorien PL 84, RO 84, BG 1117, PT 378 sind vorbelegt (Live-Proben 14.09.2026)
 * Kategorie-ID finden: Pkw-Kategorie der Seite im Browser öffnen → Netzwerk-Tab → Aufruf „api/v1/offers/?…category_id=…“.
 */
const OLX_DEFAULT_SITES: OlxSite[] = [
  { country: 'pl', host: 'www.olx.pl', categoryId: 84, currency: 'PLN', minPrice: 20000, enabled: true }, // Motoryzacja › Samochody osobowe (Live-Probe 14.09.2026)
  { country: 'ro', host: 'www.olx.ro', categoryId: 84, currency: 'EUR', minPrice: 5000, enabled: true }, // Auto, moto si ambarcatiuni › Autoturisme; Preise in EUR (Live-Probe 14.09.2026)
  { country: 'bg', host: 'www.olx.bg', categoryId: 1117, currency: 'EUR', minPrice: 5000, enabled: true }, // Автомобили, каравани, лодки › Автомобили и Джипове; Preise in EUR (Live-Probe 14.09.2026)
  { country: 'pt', host: 'www.olx.pt', categoryId: 378, currency: 'EUR', minPrice: 5000, enabled: true }, // Carros, motos e barcos › Carros; Preise in EUR (Live-Probe 14.09.2026)
];

function olxSites(): OlxSite[] {
  const sites = OLX_DEFAULT_SITES.map((s) => ({ ...s }));
  const raw = (env.OLX_SITES ?? '').trim();
  if (!raw) return sites;
  let arr: unknown;
  try { arr = JSON.parse(raw); } catch (e) { throw new Error(`OLX_SITES ist kein gültiges JSON: ${e instanceof Error ? e.message : String(e)}`); }
  if (!Array.isArray(arr)) throw new Error('OLX_SITES muss ein JSON-Array sein');
  for (const o of arr as Array<Record<string, unknown>>) {
    const country = String(o.country ?? '').toLowerCase();
    if (!country) continue;
    const cur = sites.find((s) => s.country === country);
    const patch: Partial<OlxSite> = {};
    if (o.host != null) patch.host = String(o.host);
    if (o.categoryId != null) patch.categoryId = Number(o.categoryId);
    if (o.currency != null) patch.currency = String(o.currency).toUpperCase();
    if (o.minPrice != null) patch.minPrice = Number(o.minPrice);
    if (o.enabled != null) patch.enabled = Boolean(o.enabled);
    if (cur) Object.assign(cur, patch);
    else sites.push({ country, host: patch.host ?? `www.olx.${country}`, categoryId: patch.categoryId ?? null, currency: patch.currency ?? 'EUR', minPrice: patch.minPrice ?? 5000, enabled: patch.enabled ?? true });
  }
  return sites;
}

export const config = {
  port: num(env.PORT, 4000),
  host: env.HOST ?? '0.0.0.0',
  corsOrigins: list(env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:3000'),
  adminKey: env.ADMIN_KEY ?? '',
  cronSecret: env.CRON_SECRET ?? '',
  database: {
    url: databaseUrl(),
    authToken: env.TURSO_AUTH_TOKEN || env.DATABASE_AUTH_TOKEN || undefined,
  },
  syncIntervalMin: num(env.SYNC_INTERVAL_MIN, 0),
  /** CDN-Cache-Dauer für öffentliche Lese-Antworten in Sekunden (0 = aus). Standard 10 Minuten. */
  apiCacheSeconds: num(env.API_CACHE_SECONDS, 600),
  enableMockProvider: bool(env.ENABLE_MOCK_PROVIDER, true),
  marketcheck: {
    apiKey: env.MARKETCHECK_API_KEY ?? '',
    makes: list(env.MARKETCHECK_MAKES ?? 'Toyota,Ford,Chevrolet,Dodge'),
  },
  ebay: {
    clientId: env.EBAY_CLIENT_ID ?? '',
    clientSecret: env.EBAY_CLIENT_SECRET ?? '',
    marketplaceId: env.EBAY_MARKETPLACE_ID ?? 'EBAY_US',
  },
  partnerFeeds: partnerFeeds(),
  /** Gemeinsame Einstellungen der europäischen Frontend-Endpunkte (OLX, Subito, Sauto) */
  europe: {
    /** Optionaler Residential-Proxy, falls eine Seite Rechenzentrums-IPs ablehnt (Form wie ENCAR_PROXY_URL) */
    proxyUrl: env.EUROPE_PROXY_URL ?? '',
    userAgent: env.EUROPE_USER_AGENT ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  },
  /**
   * Vergleichspreise aus dem deutschen Markt (mobile.de, JSON-Endpunkt der mobile.de-Web-App, kein Key; Grauzone
   * wie Encar). Buckets werden per GitHub Actions vorgeladen (cli/reference.ts) und beim Ausliefern nur gelesen.
   */
  reference: {
    /** Standard an (live bestätigt 15.09.2026); REFERENCE_ENABLED=false schaltet Kachelwerte, Detailkarte und Job ab */
    enabled: bool(env.REFERENCE_ENABLED, true),
    /** 'url' = search.html-Adresse als Parameter `url` an /consumer/api/search/srp (bestätigt 15.09.2026); 'query' = Parameter direkt (liefert 400) */
    mobileMode: (env.REFERENCE_MOBILE_MODE ?? 'url') as 'query' | 'url',
    ttlDays: num(env.REFERENCE_TTL_DAYS, 7),
    /** Buckets je Lauf (mobile.de-Anfragen = Buckets × Seiten) */
    maxPerRun: num(env.REFERENCE_MAX_PER_RUN, 1500),
    /** Zeitbudget je Lauf in Minuten – danach endet der Job regulär, der Rest folgt im nächsten Lauf */
    maxMinutes: num(env.REFERENCE_MAX_MINUTES, 45),
    /** Jede Bucket-Zeile protokollieren (Standard: erste 20, dann Zwischensummen alle 100) */
    verbose: bool(env.REFERENCE_VERBOSE, false),
    pages: num(env.REFERENCE_PAGES, 2),
    delayMs: num(env.REFERENCE_DELAY_MS, 700),
    /** Baujahr ± Jahre im Suchband, wenn keine Baureihe (W221, F30 …) erkannt wird – sonst gilt deren Bauzeitraum */
    yearSpan: num(env.REFERENCE_YEAR_SPAN, 1),
    /** Laufleistung vergleichbarer Angebote höchstens +50 % unter 100.000 km bzw. +30 % darüber (nach unten offen) */
    kmThreshold: num(env.REFERENCE_KM_THRESHOLD, 100000),
    kmWindowBelow: num(env.REFERENCE_KM_WINDOW_BELOW, 0.5),
    kmWindowAbove: num(env.REFERENCE_KM_WINDOW_ABOVE, 0.3),
    /** Hubraum-Toleranz für „gleiche Motorisierung“ (Anteil), wenn beide Seiten einen Hubraum kennen */
    ccmTolerance: num(env.REFERENCE_CCM_TOLERANCE, 0.12),
    /** Leistungs-Toleranz (Anteil, mindestens 8 kW), wenn beide Seiten die Leistung kennen */
    kwTolerance: num(env.REFERENCE_KW_TOLERANCE, 0.15),
    /** Detailansicht darf fehlende Buckets live nachladen (eine mobile.de-Anfrage) */
    liveLookup: bool(env.REFERENCE_LIVE_LOOKUP, true),
    proxyUrl: env.REFERENCE_PROXY_URL || env.EUROPE_PROXY_URL || '',
    /** Marken-IDs von mobile.de ergänzen/übersteuern: {"Genesis":8501} */
    makeIds: (() => { try { return JSON.parse(env.REFERENCE_MAKE_IDS || '{}') as Record<string, number>; } catch { return {}; } })(),
    userAgent: env.EUROPE_USER_AGENT ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  },
  /** USA: Copart-Suchendpunkt der Website (kein Login, kein Key; Grauzone wie Encar). Live bestätigt 15.09.2026: 385.803 Lose. */
  copart: {
    enabled: bool(env.COPART_ENABLED, false),
    /** Höchstens so viele Seiten je Lauf (nach Auktionstermin aufsteigend; die ersten Seiten sind meist schon gelaufen) */
    pages: num(env.COPART_PAGES, 80),
    pageSize: num(env.COPART_PAGE_SIZE, 100),
    /** Abbruch, sobald so viele Lose mit künftigem Termin oder Sofortkauf beisammen sind */
    maxLots: num(env.COPART_MAX_LOTS, 2000),
    /** Optional auf Marken einschränken (Copart-Schreibweise, z. B. BMW,MERCEDES-BENZ) */
    makes: list(env.COPART_MAKES),
    minYear: num(env.COPART_MIN_YEAR, 2012),
    /** Nur Lose mit laufender Auktion oder Sofortkauf-Preis */
    delayMs: num(env.COPART_DELAY_MS, 800),
    proxyUrl: env.COPART_PROXY_URL || '',
  },
  /** VAE: Dubizzle Motors über den Algolia-Proxy der Website (kein Key; Grauzone wie Encar). Aufrufe aus dem Netzwerk-Tab 16.09.2026. */
  dubizzle: {
    enabled: bool(env.DUBIZZLE_ENABLED, false),
    /** Treffer je Anfrage (die Website nutzt selbst 1.000; Algolia-Obergrenze je Filter ebenfalls 1.000) */
    hitsPerPage: num(env.DUBIZZLE_HITS_PER_PAGE, 1000),
    /** Höchstens so viele Anfragen je Lauf (Preisfenster + Folgeseiten) */
    maxRequests: num(env.DUBIZZLE_MAX_REQUESTS, 400),
    /** Untergrenze der Preisfenster (AED); darunter liegt kaum Exportware */
    minPriceAed: num(env.DUBIZZLE_MIN_PRICE_AED, 20000),
    minYear: num(env.DUBIZZLE_MIN_YEAR, 2012),
    delayMs: num(env.DUBIZZLE_DELAY_MS, 500),
    proxyUrl: env.DUBIZZLE_PROXY_URL || '',
  },
  olx: {
    enabled: bool(env.OLX_ENABLED, false),
    sites: olxSites().map((s) => ({ ...s, enabled: s.enabled && bool(env.OLX_ENABLED, false) })),
    /** Seiten je Land und Lauf (OLX sortiert nach Einstelldatum → die neuesten N×pageSize Inserate) */
    pages: num(env.OLX_PAGES, 25),
    pageSize: Math.min(50, num(env.OLX_PAGE_SIZE, 40)),
    /** Mindestpreis je Seite (siehe OLX_DEFAULT_SITES); OLX_MIN_PRICE überschreibt alle Seiten (0 = aus) */
    minPriceOverride: env.OLX_MIN_PRICE ? num(env.OLX_MIN_PRICE, 0) : null,
    minYear: num(env.OLX_MIN_YEAR, 2012),
    /** Mindestpreis und Baujahr auch als URL-Parameter senden (Probe 14.09.2026: beide werden durchgelassen, 315k → 195k Treffer) */
    serverFilters: bool(env.OLX_SERVER_FILTERS, true),
    /** TLS-Profil: der CloudFront-WAF blockt Nodes Standard-Fingerprint; "chrome" (Standard) oder "tls13" kommen durch */
    tlsProfile: (['node', 'chrome', 'tls13'].includes(env.OLX_TLS_PROFILE ?? '') ? env.OLX_TLS_PROFILE : 'chrome') as 'node' | 'chrome' | 'tls13',
    /** Je Anfrage eine frische Verbindung (mit TLS-Profil nicht nötig) */
    freshConnection: bool(env.OLX_FRESH_CONNECTION, false),
    delayMs: num(env.OLX_DELAY_MS, 400),
  },
  subito: {
    enabled: bool(env.SUBITO_ENABLED, false),
    /** Kategorie (c=…): 2 = Auto laut öffentlichen Scrapern – mit `npm run probe -- subito` prüfen */
    categoryId: num(env.SUBITO_CATEGORY_ID, 2),
    pages: num(env.SUBITO_PAGES, 30),
    pageSize: Math.min(100, num(env.SUBITO_PAGE_SIZE, 100)),
    /** Regionen-IDs (r=…) – leer = ganz Italien */
    regions: list(env.SUBITO_REGIONS),
    minPriceEur: num(env.SUBITO_MIN_PRICE_EUR, 5000),
    minYear: num(env.SUBITO_MIN_YEAR, 2012),
    imageRule: env.SUBITO_IMAGE_RULE ?? 'gallery-desktop-2x-jpeg',
    delayMs: num(env.SUBITO_DELAY_MS, 400),
  },
  sauto: {
    enabled: bool(env.SAUTO_ENABLED, false),
    categoryId: num(env.SAUTO_CATEGORY_ID, 838),
    pages: num(env.SAUTO_PAGES, 5),
    pageSize: Math.min(200, num(env.SAUTO_PAGE_SIZE, 200)),
    /** Preisfenster (CZK) ab Mindestpreis; maxBands begrenzt den Umfang je Lauf */
    minPriceCzk: num(env.SAUTO_MIN_PRICE_CZK, 150000),
    maxBands: num(env.SAUTO_MAX_BANDS, 10),
    minYear: num(env.SAUTO_MIN_YEAR, 2012),
    delayMs: num(env.SAUTO_DELAY_MS, 400),
  },
  encar: {
    enabled: bool(env.ENCAR_ENABLED, false),
    /** Y = koreanische Hersteller, N = Importmarken */
    carTypes: list(env.ENCAR_CAR_TYPES ?? 'Y,N').filter((t): t is 'Y' | 'N' => t === 'Y' || t === 'N'),
    /** Optional auf Hersteller einschränken (koreanische Encar-Namen); leer = alle */
    manufacturers: list(env.ENCAR_MANUFACTURERS),
    /** Hersteller, die bei Encar als Import (CarType.N) geführt werden */
    importedMakers: list(env.ENCAR_IMPORTED_MAKERS ?? 'BMW,벤츠,아우디,폭스바겐,볼보,렉서스,토요타,포르쉐,테슬라,미니,랜드로버'),
    /** Inserate je Seite (Encar-Maximum 500) und Obergrenze je Teilabfrage (Encar: Offset+Limit ≤ 10.000) */
    pageSize: num(env.ENCAR_PAGE_SIZE, 500),
    partitionMax: num(env.ENCAR_PARTITION_MAX, 9500),
    /** Testhilfe: je Teilabfrage höchstens so viele Inserate laden (0 = alle) */
    limitPartition: num(env.ENCAR_LIMIT_PARTITION, 0),
    /** Mindestpreis in 만원 (1000 = 10 Mio. KRW ≈ 6.500 €) */
    minPriceManwon: num(env.ENCAR_MIN_PRICE_MANWON, 1000),
    /** Ältestes Baujahr */
    minYear: num(env.ENCAR_MIN_YEAR, 2012),
    /** Detailabrufe je Lauf für neue Ausstattungskombinationen (englische Namen, Hubraum) */
    detailLimit: num(env.ENCAR_DETAIL_LIMIT, 1500),
    detailConcurrency: num(env.ENCAR_DETAIL_CONCURRENCY, 4),
    /** Parallel geladene Teilabfragen (Listen) */
    listConcurrency: num(env.ENCAR_LIST_CONCURRENCY, 4),
    delayMs: num(env.ENCAR_DELAY_MS, 150),
    /**
     * HTTP(S)-Proxy mit Wohnsitz-IP (Residential), z. B. http://user:pass@p.webshare.io:80.
     * api.encar.com sperrt Rechenzentrums-IPs; über einen Residential-Proxy läuft der Abruf auch aus Vercel.
     */
    proxyUrl: env.ENCAR_PROXY_URL ?? '',
  },
  apibara: {
    apiKey: env.APIBARA_API_KEY ?? '',
    platforms: list(env.APIBARA_PLATFORMS ?? 'copart,iaai'),
    make: env.APIBARA_MAKE ?? '',
    pages: num(env.APIBARA_PAGES, 2),
  },
  autoapi: {
    accessName: env.AUTOAPI_ACCESS_NAME ?? '',
    apiKey: env.AUTOAPI_API_KEY ?? '',
    sources: list(env.AUTOAPI_SOURCES ?? 'dubizzle').filter((s): s is 'dubizzle' | 'dubicars' => s === 'dubizzle' || s === 'dubicars'),
    pages: num(env.AUTOAPI_PAGES, 5),
  },
  xapikorea: {
    apiKey: env.XAPIKOREA_API_KEY ?? '',
    brands: list(env.XAPIKOREA_BRANDS ?? 'Hyundai,Kia,Genesis'),
    pages: num(env.XAPIKOREA_PAGES, 1),
    minPriceKrw: num(env.XAPIKOREA_MIN_PRICE_KRW, 10_000_000),
    fetchDetails: bool(env.XAPIKOREA_FETCH_DETAILS, false),
    delayMs: num(env.XAPIKOREA_DELAY_MS, 250),
  },
  fxBaseUrl: env.FX_BASE_URL ?? 'https://api.frankfurter.dev/v1',
} as const;
