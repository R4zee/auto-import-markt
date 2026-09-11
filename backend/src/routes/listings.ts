import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isDestCode, isMarketCode } from '../domain/markets.js';
import type { ListingQuery } from '../domain/types.js';
import { listingsRepo, partnersRepo } from '../repositories/listings.js';
import { decorate, search } from '../services/catalog.js';
import { getFx } from '../services/fx.js';
import { referenceEnabled, referencePrices } from '../services/reference.js';

const csv = (v: unknown) => (typeof v === 'string' && v.length ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

const querySchema = z.object({
  q: z.string().max(120).optional(),
  offer: z.enum(['all', 'auction', 'fixed']).optional(),
  markets: z.string().optional(),
  make: z.string().max(60).optional(),
  model: z.string().max(60).optional(),
  location: z.string().max(60).optional(),
  yearFrom: z.coerce.number().int().min(1900).max(2100).optional(),
  yearTo: z.coerce.number().int().min(1900).max(2100).optional(),
  maxKm: z.coerce.number().int().min(0).optional(),
  fuels: z.string().optional(),
  transmissions: z.string().optional(),
  cocOnly: z.enum(['true', 'false', '1', '0']).optional(),
  maxLanded: z.coerce.number().min(0).optional(),
  dest: z.string().optional(),
  sort: z.enum(['landed-asc', 'landed-desc', 'year-desc', 'km-asc', 'ending']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

export async function listingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/listings', async (req, reply) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_query', issues: parsed.error.issues });
    const p = parsed.data;
    await getFx();
    const q: ListingQuery = {
      q: p.q,
      offer: p.offer,
      markets: csv(p.markets).filter(isMarketCode),
      make: p.make,
      model: p.model,
      location: p.location,
      yearFrom: p.yearFrom,
      yearTo: p.yearTo,
      maxKm: p.maxKm,
      fuels: csv(p.fuels) as ListingQuery['fuels'],
      transmissions: csv(p.transmissions).filter((t) => t === 'Automatic' || t === 'Manual') as ListingQuery['transmissions'],
      cocOnly: p.cocOnly === 'true' || p.cocOnly === '1',
      maxLandedEur: p.maxLanded,
      dest: isDestCode(p.dest) ? p.dest : 'DE',
      sort: p.sort,
      page: p.page,
      pageSize: p.pageSize,
    };
    return search(q);
  });

  /** Mehrere Listings auf einmal (Merkliste / Vergleich) – vor der :id-Route registrieren */
  app.get<{ Querystring: { ids?: string; dest?: string } }>('/api/listings/batch', async (req) => {
    await getFx();
    const dest = isDestCode(req.query.dest) ? req.query.dest : 'DE';
    const ids = csv(req.query.ids).slice(0, 100);
    const partners = Object.fromEntries((await partnersRepo.all()).map((p) => [p.id, p]));
    return { items: (await listingsRepo.byIds(ids)).map((l) => decorate(l, dest)), partners };
  });

  app.get<{ Params: { id: string }; Querystring: { dest?: string } }>('/api/listings/:id', async (req, reply) => {
    const l = await listingsRepo.byId(req.params.id);
    if (!l) return reply.code(404).send({ error: 'not_found' });
    await getFx();
    const dest = isDestCode(req.query.dest) ? req.query.dest : 'DE';
    const partner = await partnersRepo.byId(l.partnerId);
    return { listing: decorate(l, dest), partner, referenceAvailable: referenceEnabled() };
  });

  /** Referenzpreise vergleichbarer Fahrzeuge im Zielmarkt (mobile.de via Carapis) */
  app.get<{ Params: { id: string } }>('/api/listings/:id/reference', async (req, reply) => {
    const l = await listingsRepo.byId(req.params.id);
    if (!l) return reply.code(404).send({ error: 'not_found' });
    if (!referenceEnabled()) return reply.code(204).send();
    const ref = await referencePrices(l);
    if (!ref) return reply.code(204).send();
    return ref;
  });

  app.get('/api/partners', async () => partnersRepo.all());
}
