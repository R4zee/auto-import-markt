import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { query } from '../db.js';
import { allProviders } from '../providers/index.js';
import { listingsRepo } from '../repositories/listings.js';
import { invalidateListingCache } from '../services/catalog.js';
import { deactivateOrphans, lastRuns, syncAll, syncProvider } from '../services/sync.js';

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (req, reply) => {
    if (!config.adminKey) return reply.code(404).send({ error: 'admin_disabled' });
    if (req.headers['x-admin-key'] !== config.adminKey) return reply.code(401).send({ error: 'unauthorized' });
  });

  app.get('/api/admin/status', async () => ({
    providers: allProviders().map((p) => ({ id: p.id, label: p.label, enabled: p.id === 'mock' ? config.enableMockProvider : p.enabled() })),
    listingsBySource: await listingsRepo.countBySource(),
    database: config.database.url.startsWith('file:') || config.database.url === ':memory:' ? 'local' : 'remote',
    lastRuns: await lastRuns(),
  }));

  app.post<{ Querystring: { provider?: string } }>('/api/admin/sync', async (req, reply) => {
    let reports;
    if (req.query.provider) {
      const p = allProviders().find((x) => x.id === req.query.provider);
      if (!p) return reply.code(404).send({ error: 'unknown_provider' });
      reports = [await syncProvider(p)];
    } else {
      reports = await syncAll();
    }
    invalidateListingCache();
    return reports;
  });

  /** Bestände von Quellen ohne (aktiven) Provider deaktivieren, z. B. nach dem Entfernen eines Anbieters */
  app.post('/api/admin/cleanup', async () => {
    const deactivated = await deactivateOrphans();
    invalidateListingCache();
    return { deactivated, remaining: await listingsRepo.countBySource() };
  });

  app.get<{ Querystring: { limit?: string } }>('/api/admin/enquiries', async (req) => {
    const limit = Math.min(500, Number(req.query.limit) || 100);
    return query('SELECT * FROM enquiries ORDER BY created_at DESC LIMIT ?', [limit]);
  });
}
