import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, run } from '../db.js';
import { DEST_CODES } from '../domain/markets.js';
import { listingsRepo, partnersRepo } from '../repositories/listings.js';
import { decorate } from '../services/catalog.js';
import { getFx } from '../services/fx.js';

const base = {
  dest: z.enum(DEST_CODES as [string, ...string[]]).default('DE'),
  lang: z.enum(['en', 'de']).default('en'),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).optional().default(''),
  message: z.string().trim().max(4000).optional().default(''),
  optInspection: z.boolean().optional().default(false),
  optBid: z.boolean().optional().default(false),
};

const singleSchema = z.object({ ...base, listingId: z.string().min(1) });
const bulkSchema = z.object({ ...base, listingIds: z.array(z.string().min(1)).min(1).max(50) });

const INSERT = `INSERT INTO enquiries(id, created_at, kind, listing_ids, partner_id, dest, lang, name, email, phone, message, opt_inspection, opt_bid, landed_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export async function enquiryRoutes(app: FastifyInstance): Promise<void> {
  /** Anfrage zu einem Fahrzeug – geht an den abwickelnden Partner */
  app.post('/api/enquiries', async (req, reply) => {
    const parsed = singleSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const b = parsed.data;
    const listing = await listingsRepo.byId(b.listingId);
    if (!listing) return reply.code(404).send({ error: 'listing_not_found' });
    await getFx();
    const decorated = decorate(listing, b.dest as never);
    const partner = await partnersRepo.byId(listing.partnerId);
    const id = randomUUID();
    await run(INSERT, [id, new Date().toISOString(), 'single', JSON.stringify([listing.id]), listing.partnerId, b.dest, b.lang, b.name, b.email, b.phone, b.message,
      b.optInspection ? 1 : 0, b.optBid ? 1 : 0, JSON.stringify(decorated.landed)]);
    app.log.info({ enquiry: id, partner: partner?.name, listing: listing.id }, 'enquiry stored');
    return reply.code(201).send({ id, partner: partner ? { id: partner.id, name: partner.name } : null, landedTotalEur: decorated.landed.totalEur });
  });

  /** Sammelanfrage aus der Merkliste – wird je Partner aufgeteilt */
  app.post('/api/enquiries/bulk', async (req, reply) => {
    const parsed = bulkSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const b = parsed.data;
    const listings = await listingsRepo.byIds(b.listingIds);
    if (!listings.length) return reply.code(404).send({ error: 'listings_not_found' });
    await getFx();
    const byPartner = new Map<string, typeof listings>();
    for (const l of listings) byPartner.set(l.partnerId, [...(byPartner.get(l.partnerId) ?? []), l]);
    const created: Array<{ id: string; partnerId: string; count: number }> = [];
    const stmts = [];
    for (const [partnerId, group] of byPartner) {
      const id = randomUUID();
      const landed = Object.fromEntries(group.map((l) => [l.id, decorate(l, b.dest as never).landed.totalEur]));
      stmts.push({ sql: INSERT, args: [id, new Date().toISOString(), 'bulk', JSON.stringify(group.map((l) => l.id)), partnerId, b.dest, b.lang, b.name, b.email, b.phone, b.message,
        b.optInspection ? 1 : 0, b.optBid ? 1 : 0, JSON.stringify(landed)] });
      created.push({ id, partnerId, count: group.length });
    }
    await db().batch(stmts, 'write');
    return reply.code(201).send({ enquiries: created, total: listings.length });
  });
}
