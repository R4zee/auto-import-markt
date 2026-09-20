import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

process.env.DATABASE_PATH = ':memory:';
delete process.env.TURSO_DATABASE_URL;
delete process.env.DATABASE_URL;
process.env.ENABLE_MOCK_PROVIDER = 'true';
process.env.ENCAR_ENABLED = 'false';
process.env.CARAPIS_API_KEY = '';
// Vergleichspreise sind standardmäßig an – hier den abgeschalteten Pfad prüfen (204, referenceAvailable=false)
process.env.REFERENCE_ENABLED = 'false';
process.env.SYNC_INTERVAL_MIN = '0';
process.env.ADMIN_KEY = 'test-key';
process.env.CRON_SECRET = 'cron-secret';
process.env.VERCEL = '';
process.env.FX_BASE_URL = 'http://127.0.0.1:1'; // erzwingt Fallback-Kurse

const { buildApp, startBackgroundSync } = await import('../src/app.js');
const { closeDb } = await import('../src/db.js');

describe('API', async () => {
  const app = await buildApp({ logger: false });
  before(async () => { await startBackgroundSync(app); });
  after(async () => { await app.close(); await closeDb(); });

  it('GET /api/health', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().listings.mock, 14);
  });

  it('GET /api/listings liefert 14 Fahrzeuge, sortiert nach Endpreis', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/listings?dest=DE' });
    const body = res.json();
    assert.equal(body.total, 14);
    const totals = body.items.map((i: { landed: { totalEur: number } }) => i.landed.totalEur);
    assert.deepEqual(totals, [...totals].sort((a, b) => a - b));
    assert.equal(body.marketCounts.JP, 3);
  });

  it('sortiert nach Abstand zum DE-Vergleichspreis (ohne Vergleichspreise: alle Inserate, Reihenfolge nach Endpreis)', async () => {
    for (const sort of ['ref-asc', 'ref-desc']) {
      const res = await app.inject({ method: 'GET', url: `/api/listings?dest=DE&sort=${sort}` });
      assert.equal(res.statusCode, 200, sort);
      const body = res.json();
      assert.equal(body.total, 14);
      assert.equal(body.items.length, 14);
    }
    const bad = await app.inject({ method: 'GET', url: '/api/listings?dest=DE&sort=nope' });
    assert.equal(bad.statusCode, 400);
  });

  it('Japan und Korea haben denselben Partner (Far East Imports)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/partners' });
    const partners = res.json() as Array<{ id: string; markets: string[] }>;
    const fe = partners.find((p) => p.id === 'fareast');
    assert.ok(fe);
    assert.deepEqual([...fe.markets].sort(), ['JP', 'KR']);
    assert.ok(!partners.some((p) => p.id === 'kaido' || p.id === 'hanbit'));
    const list = await app.inject({ method: 'GET', url: '/api/listings?dest=DE&markets=JP,KR' });
    for (const it of list.json().items as Array<{ partnerId: string }>) assert.equal(it.partnerId, 'fareast');
  });

  it('Filter: nur Auktionen aus Japan', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/listings?offer=auction&markets=JP' });
    const body = res.json();
    assert.equal(body.total, 2);
    assert.ok(body.items.every((i: { auction: unknown }) => i.auction));
  });

  it('Filter: Endpreis-Obergrenze', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/listings?maxLanded=40000' });
    assert.ok(res.json().items.every((i: { landed: { totalEur: number } }) => i.landed.totalEur <= 40000));
  });

  it('GET /api/listings/:id inkl. Partner', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/listings/mock:jp1?dest=AT' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.partner.name, 'Far East Imports');
    assert.equal(body.listing.landed.vatRate, 0.2);
    assert.equal(body.referenceAvailable, false);
  });

  it('GET /api/listings/batch', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/listings/batch?ids=mock:jp1,mock:us1&dest=DE' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().items.length, 2);
  });

  it('GET /api/listings/:id/reference mit REFERENCE_ENABLED=false → 204', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/listings/mock:jp1/reference' });
    assert.equal(res.statusCode, 204);
  });

  it('POST /api/calc/landed-cost', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/calc/landed-cost',
      payload: { market: 'US', dest: 'DE', price: 50000, currency: 'USD', vehicle: { fuel: 'Petrol', engineCcm: 6162, co2Gkm: 290, firstRegistration: '2022-03-01' } },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.landed.dutyRate, 0.1);
    assert.ok(body.vehicleTax.annualEur > 0);
  });

  it('POST /api/enquiries speichert und routet zum Partner', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/enquiries',
      payload: { listingId: 'mock:us1', name: 'Test Person', email: 'test@example.com', message: 'Hallo', optInspection: true, dest: 'DE', lang: 'de' },
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().partner.name, 'Atlantic Vehicle Logistics');
    const list = await app.inject({ method: 'GET', url: '/api/admin/enquiries', headers: { 'x-admin-key': 'test-key' } });
    assert.equal(list.json().length, 1);
  });

  it('POST /api/enquiries/bulk teilt nach Partner auf', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/enquiries/bulk',
      // Japan und Korea teilen sich einen Partner (Far East Imports), die USA einen anderen → zwei Anfragen
      payload: { listingIds: ['mock:jp1', 'mock:kr1', 'mock:us1'], name: 'Test Person', email: 'test@example.com' },
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().enquiries.length, 2);
    assert.equal(res.json().total, 3);
  });

  it('POST /api/enquiries validiert', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/enquiries', payload: { listingId: 'mock:us1', name: 'x', email: 'nope' } });
    assert.equal(res.statusCode, 400);
  });

  it('Admin-Routen sind geschützt', async () => {
    const denied = await app.inject({ method: 'GET', url: '/api/admin/status' });
    assert.equal(denied.statusCode, 401);
    const ok = await app.inject({ method: 'GET', url: '/api/admin/status', headers: { 'x-admin-key': 'test-key' } });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().listingsBySource.mock, 14);
  });

  it('POST ohne Body / mit Formular-Content-Type wird nicht mit 415 abgelehnt', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/admin/sync?provider=mock',
      headers: { 'x-admin-key': 'test-key', 'content-type': 'application/x-www-form-urlencoded' },
      payload: '',
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json()[0].provider, 'mock');
  });

  it('Cron-Route akzeptiert nur das CRON_SECRET', async () => {
    const denied = await app.inject({ method: 'GET', url: '/api/cron/sync' });
    assert.equal(denied.statusCode, 401);
    const ok = await app.inject({ method: 'GET', url: '/api/cron/sync', headers: { authorization: 'Bearer cron-secret' } });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().reports[0].provider, 'mock');
  });

  // zuletzt: verändert den Bestand
  it('beendete Auktionen werden deaktiviert (Quellen ohne Vollabgleich wie Copart)', async () => {
    const { listingsRepo } = await import('../src/repositories/listings.js');
    const before = await app.inject({ method: 'GET', url: '/api/listings?offer=auction' });
    assert.equal(before.json().total, 6);
    // noch nichts abgelaufen (Mock-Termine liegen in der Zukunft)
    assert.equal(await listingsRepo.deactivateEndedAuctions(), 0);
    const n = await listingsRepo.deactivateEndedAuctions(new Date(Date.now() + 365 * 86400000));
    assert.equal(n, 6);
    const after = await app.inject({ method: 'GET', url: '/api/listings?offer=auction' });
    assert.equal(after.json().total, 0);
    const all = await app.inject({ method: 'GET', url: '/api/listings' });
    assert.equal(all.json().total, 8);
  });
});
