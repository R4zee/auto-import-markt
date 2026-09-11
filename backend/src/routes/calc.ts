import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { calcLandedCost } from '../domain/landedCost.ts';
import { DEST_CODES, MARKET_CODES } from '../domain/markets.ts';
import { calcGermanVehicleTax } from '../domain/vehicleTax.ts';
import { publicConfig } from '../services/catalog.ts';
import { eurRate, getFx } from '../services/fx.ts';

const calcSchema = z.object({
  market: z.enum(MARKET_CODES as [string, ...string[]]),
  dest: z.enum(DEST_CODES as [string, ...string[]]).default('DE'),
  price: z.number().positive(),
  currency: z.string().length(3),
  classic: z.boolean().optional(),
  originProof: z.boolean().optional(),
  dutyRateOverride: z.number().min(0).max(1).nullable().optional(),
  vehicle: z
    .object({
      fuel: z.enum(['Petrol', 'Diesel', 'Hybrid', 'Electric']),
      engineCcm: z.number().int().positive().nullable().optional(),
      co2Gkm: z.number().int().min(0).nullable().optional(),
      firstRegistration: z.string(),
    })
    .optional(),
});

export async function calcRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/config', async () => {
    const fx = await getFx();
    return { ...publicConfig(), fx: { rates: fx.rates, asOf: fx.asOf, source: fx.source } };
  });

  app.get('/api/fx', async () => {
    const fx = await getFx();
    return { rates: fx.rates, asOf: fx.asOf, source: fx.source };
  });

  app.post('/api/calc/landed-cost', async (req, reply) => {
    const parsed = calcSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const b = parsed.data;
    await getFx();
    let fxRate: number;
    try {
      fxRate = eurRate(b.currency);
    } catch {
      return reply.code(400).send({ error: 'unknown_currency' });
    }
    const landed = calcLandedCost({
      market: b.market as never,
      dest: b.dest as never,
      price: b.price,
      currency: b.currency,
      classic: b.classic,
      originProof: b.originProof,
      dutyRateOverride: b.dutyRateOverride ?? null,
      fxRate,
    });
    const vehicleTax = b.dest === 'DE' && b.vehicle
      ? calcGermanVehicleTax({
          fuel: b.vehicle.fuel,
          engineCcm: b.vehicle.engineCcm ?? null,
          co2Gkm: b.vehicle.co2Gkm ?? null,
          firstRegistration: b.vehicle.firstRegistration,
        })
      : null;
    return { landed, vehicleTax };
  });
}
