import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isDestCode, isMarketCode } from '../domain/markets.js';
import type { ListingQuery } from '../domain/types.js';
import { listingsRepo, partnersRepo } from '../repositories/listings.js';
import { decorate, search } from '../services/catalog.js';
import { getFx } from '../services/fx.js';
import { publicCache } from '../services/httpCache.js';
import { attachReferences, referenceEnabled, referencePrices } from '../services/reference.js';

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
    // Kurse parallel zur Datenbankabfrage laden (die Kalkulation braucht sie erst beim Dekorieren)
    const [, result] = await Promise.all([getFx(), search(q)]);
    publicCache(reply);
    return result;
  });

  /** Mehrere Listings auf einmal (Merkliste / Vergleich) – vor der :id-Route registrieren */
  app.get<{ Querystring: { ids?: string; dest?: string } }>('/api/listings/batch', async (req, reply) => {
    const dest = isDestCode(req.query.dest) ? req.query.dest : 'DE';
    const ids = csv(req.query.ids).slice(0, 100);
    const [, partnerList, items] = await Promise.all([getFx(), partnersRepo.all(), listingsRepo.byIds(ids)]);
    const partners = Object.fromEntries(partnerList.map((p) => [p.id, p]));
    const decorated = items.map((l) => decorate(l, dest));
    await attachReferences(decorated);
    publicCache(reply);
    return { items: decorated, partners };
  });

  app.get<{ Params: { id: string }; Querystring: { dest?: string } }>('/api/listings/:id', async (req, reply) => {
    const [, l] = await Promise.all([getFx(), listingsRepo.byId(req.params.id)]);
    if (!l) return reply.code(404).send({ error: 'not_found' });
    const dest = isDestCode(req.query.dest) ? req.query.dest : 'DE';
    const partner = await partnersRepo.byId(l.partnerId);
    const listing = decorate(l, dest);
    await attachReferences([listing]);
    publicCache(reply);
    return { listing, partner, referenceAvailable: referenceEnabled() };
  });

  /**
   * Vergleichspreise DE (mobile.de) für die Detailansicht: Laufleistungsfenster und Motorisierung des Inserats,
   * Abstand des Endpreises inkl. TÜV zum günstigsten Angebot. Fehlt der Bucket im Cache, wird er (wenn erlaubt) live geholt.
   */
  app.get<{ Params: { id: string }; Querystring: { dest?: string } }>('/api/listings/:id/reference', async (req, reply) => {
    const [, l] = await Promise.all([getFx(), listingsRepo.byId(req.params.id)]);
    if (!l) return reply.code(404).send({ error: 'not_found' });
    if (!referenceEnabled()) return reply.code(204).send();
    const dest = isDestCode(req.query.dest) ? req.query.dest : 'DE';
    const ref = await referencePrices(l, decorate(l, dest).landed.totalEur);
    if (!ref) return reply.code(204).send();
    publicCache(reply);
    return ref;
  });

  app.get('/api/partners', async (_req, reply) => {
    publicCache(reply);
    return partnersRepo.all();
  });
}
