import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { config, databaseMissing, isServerless } from './config.js';
import { dbReadOnly, one, query, ready } from './db.js';
import { listingsRepo } from './repositories/listings.js';
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

  app.get('/api/health', async () => ({
    ok: !databaseMissing,
    listings: await listingsRepo.countBySource(),
    serverless: isServerless,
    // Turso sperrt Schreibzugriffe bei erschöpftem Plan-Kontingent; die Website liest dann weiter, Jobs schlagen fehl
    writes: dbReadOnly() ? 'BLOCKED – Turso-Kontingent (Usage/Plan) prüfen; Sync und Vergleichspreise schreiben nicht' : 'ok',
    database: databaseMissing ? 'MISSING – TURSO_DATABASE_URL/TURSO_AUTH_TOKEN setzen und redeployen' : config.database.url.startsWith('file:') ? 'local-file' : config.database.url === ':memory:' ? 'memory' : 'remote',
    time: new Date().toISOString(),
  }));

  /**
   * Stand der Vergleichspreis-Spalten (Diagnose ohne Datenbankzugang, 21.09.2026): Migrationsmerker, offene Inserate
   * (Teilindex), Inserate mit Abstand sowie Auktionen, die entgegen firmPrice() noch einen Abstand tragen (sollen 0 sein).
   * Zählungen laufen über den abdeckenden Suchindex (wenige Sekunden), nicht über die Zeilen.
   */
  app.get('/api/health/reference', async () => {
    const meta = await query<{ key: string; value: string }>("SELECT key, value FROM meta WHERE key IN ('ref_key_version', 'ref_diff_auction_null')");
    const [pending, withDiff, auctionsWithDiff, topAuctions] = await Promise.all([
      one<{ n: number }>("SELECT COUNT(*) AS n FROM listings WHERE ref_min_eur IS NULL AND active = 1 AND ref_key <> ''"),
      one<{ n: number }>('SELECT COUNT(*) AS n FROM listings WHERE active = 1 AND ref_diff_de IS NOT NULL'),
      one<{ n: number }>("SELECT COUNT(*) AS n FROM listings WHERE active = 1 AND offer_type = 'auction' AND ref_diff_de IS NOT NULL"),
      query<{ id: string; ref_diff_de: number; fetched_at: string }>("SELECT id, ref_diff_de, fetched_at FROM listings WHERE active = 1 AND offer_type = 'auction' AND ref_diff_de IS NOT NULL ORDER BY ref_diff_de DESC LIMIT 3"),
    ]);
    return {
      meta: Object.fromEntries(meta.map((r) => [r.key, r.value])),
      pending: Number(pending?.n ?? 0),
      withDiff: Number(withDiff?.n ?? 0),
      auctionsWithDiff: Number(auctionsWithDiff?.n ?? 0),
      topAuctions,
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
