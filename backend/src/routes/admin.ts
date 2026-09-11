import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import { query } from '../db.ts';
import { mapCarapis, parseSources } from '../providers/carapis.ts';
import { allProviders } from '../providers/index.ts';
import { listingsRepo } from '../repositories/listings.ts';
import { carapisEnabled, fetchBrands, fetchSources, fetchVehicles } from '../services/carapisClient.ts';
import { invalidateListingCache } from '../services/catalog.ts';
import { lastRuns, syncAll, syncProvider } from '../services/sync.ts';

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

  app.get<{ Querystring: { limit?: string } }>('/api/admin/enquiries', async (req) => {
    const limit = Math.min(500, Number(req.query.limit) || 100);
    return query('SELECT * FROM enquiries ORDER BY created_at DESC LIMIT ?', [limit]);
  });

  /** Carapis: verfügbare Quellen (Codes für CARAPIS_SOURCES) */
  app.get('/api/admin/carapis/sources', async (_req, reply) => {
    if (!carapisEnabled()) return reply.code(400).send({ error: 'carapis_not_configured' });
    return { configured: parseSources(config.carapis.sources), sources: await fetchSources() };
  });

  /** Carapis: Rohdatensatz + Mapping-Ergebnis zur Prüfung der Feldnamen */
  app.get<{ Querystring: { source?: string; brand?: string; model?: string } }>('/api/admin/carapis/probe', async (req, reply) => {
    if (!carapisEnabled()) return reply.code(400).send({ error: 'carapis_not_configured' });
    const source = req.query.source ?? parseSources(config.carapis.sources)[0]?.source ?? 'encar';
    const market = parseSources(config.carapis.sources).find((s) => s.source === source)?.market ?? 'KR';
    const page = await fetchVehicles({ source, brand: req.query.brand, model: req.query.model, page_size: 3 });
    return {
      source, market, count: page.count, next: page.next,
      raw: page.results,
      mapped: page.results.map((v) => mapCarapis(v, market, new Date().toISOString(), source)),
    };
  });

  app.get<{ Querystring: { search?: string } }>('/api/admin/carapis/brands', async (req, reply) => {
    if (!carapisEnabled()) return reply.code(400).send({ error: 'carapis_not_configured' });
    return fetchBrands(req.query.search);
  });
}
