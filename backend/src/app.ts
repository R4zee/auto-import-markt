import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { config, databaseMissing, isServerless } from './config.js';
import { dbReadOnly, one, query, ready } from './db.js';
import { listingsRepo } from './repositories/listings.js';
import { getFacets } from './services/facets.js';
import { adminRoutes } from './routes/admin.js';
import { calcRoutes } from './routes/calc.js';
import { enquiryRoutes } from './routes/enquiries.js';
import { listingRoutes } from './routes/listings.js';
import { invalidateListingCache } from './services/catalog.js';
import { syncAll } from './services/sync.js';

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? true, trustProxy: true });
  await ready();

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || config.corsOrigins.includes(origin) || config.corsOrigins.includes('*')) return cb(null, true);
      cb(new Error('CORS: origin not allowed'), false);
    },
  });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  // Leere oder nicht-JSON-Bodys (z. B. PowerShell Invoke-RestMethod ohne -Body) nicht mit 415 ablehnen
  app.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body.trim() : '';
    if (!text) return done(null, undefined);
    try { done(null, JSON.parse(text)); } catch (e) { done(e as Error, undefined); }
  });

  // Bestand je Markt aus dem Facetten-Cache (eine kleine Zeile) statt Zählung über alle aktiven Inserate: die kostete
  // auf Turso 25 s und auf dem eigenen libsql-Server über eine Minute je Aufruf. Je Quelle: /api/admin/status.
  app.get('/api/health', async () => ({
    ok: !databaseMissing,
    listings: (await getFacets()).marketCounts.all,
    total: (await getFacets()).total,
    serverless: isServerless,
    // Schema und Indizes pflegen die Jobs (Sync, Vergleichspreise); die Function fasst die Datenbank beim Start nicht an
    migrations: isServerless ? 'job' : 'app',
    // Turso sperrt Schreibzugriffe bei erschöpftem Plan-Kontingent; die Website liest dann weiter, Jobs schlagen fehl
    writes: dbReadOnly() ? 'BLOCKED – Turso-Kontingent (Usage/Plan) prüfen; Sync und Vergleichspreise schreiben nicht' : isServerless ? 'nicht geprüft – die Function schreibt nicht, Schreibfehler zeigen die Job-Protokolle' : 'ok',
    database: databaseMissing ? 'MISSING – TURSO_DATABASE_URL/TURSO_AUTH_TOKEN setzen und redeployen' : config.database.url.startsWith('file:') ? 'local-file' : config.database.url === ':memory:' ? 'memory' : 'remote',
    time: new Date().toISOString(),
  }));

  /**
   * Stand der Vergleichspreis-Spalten (Diagnose ohne Datenbankzugang, 21.09.2026): Migrationsmerker, offene Inserate
   * (Teilindex), Inserate mit Abstand sowie Auktionen, die entgegen firmPrice() noch einen Abstand tragen (sollen 0 sein).
   * Indizes erzwingen: ohne Tabellenstatistik las der Planer für die offenen Inserate und die Auktions-Prüfung alle
   * aktiven Zeilen einzeln (131 s auf dem eigenen Server, 22.09.2026). Die Auktions-Prüfung läuft nur über die Märkte,
   * die laut Facetten-Cache Auktionen haben (US, CA, JP: ~10.000 Zeilen über den Marktindex) – der abdeckende Suchindex
   * enthält den Suchtext und ist für einen Lauf über alle 284.000 aktiven Einträge zu breit (67 s). `timingsMs` je Teil.
   */
  app.get('/api/health/reference', async () => {
    const timed = async <T>(p: Promise<T>): Promise<[T, number]> => { const t = Date.now(); const v = await p; return [v, Date.now() - t]; };
    const meta = await query<{ key: string; value: string }>("SELECT key, value FROM meta WHERE key IN ('ref_key_version', 'ref_diff_auction_null', 'ref_diff_auction_null_v2')");
    const auctionMarkets = Object.entries((await getFacets()).marketCounts.auction).filter(([, n]) => n > 0).map(([m]) => m);
    const marks = auctionMarkets.map(() => '?').join(',');
    const auctionWhere = `market IN (${marks}) AND active = 1 AND offer_type = 'auction' AND ref_diff_de IS NOT NULL`;
    const [[pending, tPending], [withDiff, tWithDiff], [auctionsWithDiff, tAuctions], [topAuctions, tTop]] = await Promise.all([
      timed(one<{ n: number }>("SELECT COUNT(*) AS n FROM listings INDEXED BY idx_listings_ref_pending WHERE ref_min_eur IS NULL AND active = 1 AND ref_key <> ''")),
      timed(one<{ n: number }>('SELECT COUNT(*) AS n FROM listings WHERE active = 1 AND ref_diff_de IS NOT NULL')),
      timed(auctionMarkets.length ? one<{ n: number }>(`SELECT COUNT(*) AS n FROM listings INDEXED BY idx_listings_market WHERE ${auctionWhere}`, auctionMarkets) : Promise.resolve(null)),
      timed(auctionMarkets.length ? query<{ id: string; ref_diff_de: number; fetched_at: string }>(`SELECT id, ref_diff_de, fetched_at FROM listings INDEXED BY idx_listings_market WHERE ${auctionWhere} ORDER BY ref_diff_de DESC LIMIT 3`, auctionMarkets) : Promise.resolve([])),
    ]);
    return {
      meta: Object.fromEntries(meta.map((r) => [r.key, r.value])),
      pending: Number(pending?.n ?? 0),
      withDiff: Number(withDiff?.n ?? 0),
      auctionsWithDiff: Number(auctionsWithDiff?.n ?? 0),
      auctionMarkets,
      topAuctions,
      timingsMs: { pending: tPending, withDiff: tWithDiff, auctionsWithDiff: tAuctions, topAuctions: tTop },
      time: new Date().toISOString(),
    };
  });

  /** Vercel Cron (GET) – Header "Authorization: Bearer <CRON_SECRET>"; alternativ x-admin-key */
  app.get('/api/cron/sync', async (req, reply) => {
    const auth = req.headers.authorization ?? '';
    const okCron = config.cronSecret && auth === `Bearer ${config.cronSecret}`;
    const okAdmin = config.adminKey && req.headers['x-admin-key'] === config.adminKey;
    if (!okCron && !okAdmin) return reply.code(401).send({ error: 'unauthorized' });
    const reports = await syncAll();
    invalidateListingCache();
    return { reports, at: new Date().toISOString() };
  });

  await app.register(listingRoutes);
  await app.register(calcRoutes);
  await app.register(enquiryRoutes);
  await app.register(adminRoutes);

  return app;
}

/** Erstbefüllung, falls die Datenbank leer ist, plus optionaler Intervall-Sync (nicht auf Vercel). */
export async function startBackgroundSync(app: FastifyInstance): Promise<void> {
  if (isServerless) return;
  const total = Object.values(await listingsRepo.countBySource()).reduce((a, b) => a + b, 0);
  if (total === 0) {
    const reports = await syncAll();
    app.log.info({ reports }, 'initial sync');
  }
  if (config.syncIntervalMin > 0) {
    const timer = setInterval(async () => {
      const reports = await syncAll();
      invalidateListingCache();
      app.log.info({ reports }, 'scheduled sync');
    }, config.syncIntervalMin * 60_000);
    timer.unref();
  }
}
