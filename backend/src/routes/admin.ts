import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { query } from '../db.js';
import { describeNetworkError } from '../providers/http.js';
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

  /** Netzwerkdiagnose aus der Function heraus: erreicht Vercel den Zielhost? */
  app.get<{ Querystring: { url?: string } }>('/api/admin/diag', async (req) => {
    const targets = req.query.url
      ? [req.query.url]
      : [
          'https://api.encar.com/search/car/list/premium?count=true&q=(And.Hidden.N._.CarType.Y.)&sr=%7CModifiedDate%7C0%7C1',
          'https://fem.encar.com/',
          'https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD',
        ];
    const results = [];
    for (const url of targets) {
      const t0 = Date.now();
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { Accept: 'application/json,text/html' }, redirect: 'manual' });
        const body = await res.text().catch(() => '');
        results.push({ url, ok: res.ok, status: res.status, ms: Date.now() - t0, server: res.headers.get('server'), bodyStart: body.slice(0, 160) });
      } catch (e) {
        const err = describeNetworkError(e, url);
        results.push({ url, ok: false, error: err.message, name: err.name, ms: Date.now() - t0 });
      }
    }
    return { region: process.env.VERCEL_REGION ?? null, node: process.version, results };
  });

  app.get<{ Querystring: { limit?: string } }>('/api/admin/enquiries', async (req) => {
    const limit = Math.min(500, Number(req.query.limit) || 100);
    return query('SELECT * FROM enquiries ORDER BY created_at DESC LIMIT ?', [limit]);
  });
}
