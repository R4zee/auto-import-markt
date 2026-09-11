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
    manufacturers: list(env.ENCAR_MANUFACTURERS ?? '현대,기아,제네시스'),
    /** Hersteller, die bei Encar als Import (CarType.N) geführt werden */
    importedMakers: list(env.ENCAR_IMPORTED_MAKERS ?? 'BMW,벤츠,아우디,폭스바겐,볼보,렉서스,토요타,포르쉐,테슬라,미니,랜드로버'),
    /** Fahrzeuge je Hersteller und Lauf (seitenweise geholt) */
    limitPerMaker: num(env.ENCAR_LIMIT_PER_MAKER, 60),
    pageSize: num(env.ENCAR_PAGE_SIZE, 50),
    /** Mindestpreis in 만원 (1000 = 10 Mio. KRW ≈ 6.500 €) */
    minPriceManwon: num(env.ENCAR_MIN_PRICE_MANWON, 1000),
    /** Ältestes Baujahr (0 = kein Filter) */
    minYear: num(env.ENCAR_MIN_YEAR, 2012),
    fetchDetails: bool(env.ENCAR_FETCH_DETAILS, true),
    detailConcurrency: num(env.ENCAR_DETAIL_CONCURRENCY, 3),
    delayMs: num(env.ENCAR_DELAY_MS, 200),
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
