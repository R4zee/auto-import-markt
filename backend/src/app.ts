import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { config, isServerless } from './config.ts';
import { ready } from './db.ts';
import { listingsRepo } from './repositories/listings.ts';
import { adminRoutes } from './routes/admin.ts';
import { calcRoutes } from './routes/calc.ts';
import { enquiryRoutes } from './routes/enquiries.ts';
import { listingRoutes } from './routes/listings.ts';
import { invalidateListingCache } from './services/catalog.ts';
import { syncAll } from './services/sync.ts';

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

  app.get('/api/health', async () => ({ ok: true, listings: await listingsRepo.countBySource(), serverless: isServerless, time: new Date().toISOString() }));

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
