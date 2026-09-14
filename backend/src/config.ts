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
  /** mobile.de Search API (API-Account über den mobile.de-Kundensupport; HTTP Basic) */
  mobilede: {
    baseUrl: env.MOBILEDE_BASE_URL ?? 'https://services.mobile.de',
    username: env.MOBILEDE_USERNAME ?? '',
    password: env.MOBILEDE_PASSWORD ?? '',
    /** Verkäuferländer (ISO-2); leer = alle Länder aus MARKET_COUNTRIES (Süd- und Osteuropa) */
    countries: list(env.MOBILEDE_COUNTRIES).map((c) => c.toLowerCase()),
    pages: num(env.MOBILEDE_PAGES, 20),
    pageSize: num(env.MOBILEDE_PAGE_SIZE, 100),
    minPriceEur: num(env.MOBILEDE_MIN_PRICE_EUR, 5000),
    minYear: num(env.MOBILEDE_MIN_YEAR, 2012),
    delayMs: num(env.MOBILEDE_DELAY_MS, 250),
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
