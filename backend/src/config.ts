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
  jpFeed: {
    url: env.JP_FEED_URL ?? '',
    authHeader: env.JP_FEED_AUTH_HEADER ?? '',
    mapping: env.JP_FEED_MAPPING ?? '',
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
