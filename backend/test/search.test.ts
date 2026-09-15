import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

process.env.DATABASE_PATH = ':memory:';
delete process.env.TURSO_DATABASE_URL;
delete process.env.DATABASE_URL;
process.env.ENABLE_MOCK_PROVIDER = 'true';
process.env.ENCAR_ENABLED = 'false';
process.env.VERCEL = '';
process.env.FX_BASE_URL = 'http://127.0.0.1:1';
process.env.API_CACHE_SECONDS = '600';

const { buildApp, startBackgroundSync } = await import('../src/app.js');
const { closeDb } = await import('../src/db.js');
const { listingsRepo } = await import('../src/repositories/listings.js');
const { getFacets } = await import('../src/services/facets.js');

describe('Suche (SQL) und Facetten-Cache', async () => {
  const app = await buildApp({ logger: false });
  before(async () => { await startBackgroundSync(app); });
  after(async () => { await app.close(); await closeDb(); });

  it('Facetten stammen aus dem Cache und decken Marken, Modelle je Marke, Standorte und Marktzähler ab', async () => {
    const f = await getFacets();
    assert.equal(f.total, 14);
    assert.ok(f.makes.includes('BMW'));
    assert.deepEqual(f.modelsByMake.Toyota, ['Hilux Revo', 'Land Cruiser 70']);
    assert.ok(f.locations.includes('Warsaw'));
    assert.equal(f.marketCounts.all.JP, 3);
    assert.equal(f.marketCounts.auction.JP, 2);
    assert.equal(f.marketCounts.fixed.JP, 1);
  });

  it('Markenfilter nutzt den Index-Pfad (Fensterfunktion) und liefert korrekte Gesamtzahl + Modell-Facette', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/listings?make=Toyota&yearFrom=1985&yearTo=2026&maxKm=300000&maxLanded=300000' });
    const body = res.json();
    assert.equal(body.total, 2);
    assert.equal(body.items.length, 2);
    assert.deepEqual(body.facets.models, ['Hilux Revo', 'Land Cruiser 70']);
    assert.ok(body.facets.makes.length > 5, 'Markenliste bleibt vollständig');
    assert.equal(body.marketCounts.JP, 3);
  });

  it('Marktzähler folgen der Angebotsart', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/listings?offer=auction' });
    assert.equal(res.json().marketCounts.JP, 2);
    assert.equal(res.json().marketCounts.KR, 1);
  });

  it('Textsuche über search_text (Marke, Modell, Losnummer)', async () => {
    const byModel = await app.inject({ method: 'GET', url: '/api/listings?q=corvette' });
    assert.equal(byModel.json().total, 1);
    const byLot = await app.inject({ method: 'GET', url: '/api/listings?q=41208' });
    assert.equal(byLot.json().items[0].id, 'mock:jp1');
    const none = await app.inject({ method: 'GET', url: '/api/listings?q=gibtsnicht' });
    assert.equal(none.json().total, 0);
    assert.equal(none.json().items.length, 0);
  });

  it('Paginierung: Seite 2 schließt an Seite 1 an, Gesamtzahl bleibt', async () => {
    const p1 = await app.inject({ method: 'GET', url: '/api/listings?pageSize=5&page=1' });
    const p2 = await app.inject({ method: 'GET', url: '/api/listings?pageSize=5&page=2' });
    assert.equal(p1.json().items.length, 5);
    assert.equal(p2.json().items.length, 5);
    assert.equal(p2.json().total, 14);
    assert.equal(p2.json().page, 2);
    const ids = new Set([...p1.json().items, ...p2.json().items].map((i: { id: string }) => i.id));
    assert.equal(ids.size, 10);
    const beyond = await app.inject({ method: 'GET', url: '/api/listings?make=Toyota&pageSize=5&page=9' });
    assert.equal(beyond.json().items.length, 0);
    assert.equal(beyond.json().total, 2);
  });

  it('Trefferliste enthält nur das erste Foto, die Detailansicht alle', async () => {
    const [us1] = await listingsRepo.byIds(['mock:us1']);
    await listingsRepo.upsertMany([{ ...us1, photos: ['https://img/1.jpg', 'https://img/2.jpg', 'https://img/3.jpg'], photoCount: 3 }]);
    const list = await app.inject({ method: 'GET', url: '/api/listings?q=corvette' });
    const item = list.json().items[0];
    assert.equal(item.id, 'mock:us1');
    assert.deepEqual(item.photos, ['https://img/1.jpg']);
    assert.equal(item.photoCount, 3);
    const detail = await app.inject({ method: 'GET', url: `/api/listings/${encodeURIComponent(item.id)}` });
    assert.equal(detail.json().listing.photos.length, 3);
    const noPhotos = await app.inject({ method: 'GET', url: '/api/listings?q=giulia' });
    assert.deepEqual(noPhotos.json().items[0].photos, []);
  });

  it('Sortierungen mit Bereichsfiltern liefern konsistente Reihenfolge', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/listings?sort=km-asc&maxKm=300000&yearFrom=1985' });
    const kms = res.json().items.map((i: { km: number }) => i.km);
    assert.deepEqual(kms, [...kms].sort((a, b) => a - b));
    const desc = await app.inject({ method: 'GET', url: '/api/listings?sort=landed-desc&make=Toyota' });
    const totals = desc.json().items.map((i: { landed: { totalEur: number } }) => i.landed.totalEur);
    assert.deepEqual(totals, [...totals].sort((a, b) => b - a));
  });

  it('öffentliche Lese-Antworten tragen CDN-Cache-Header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/listings' });
    assert.match(String(res.headers['cache-control']), /s-maxage=600/);
    const cfg = await app.inject({ method: 'GET', url: '/api/config' });
    assert.match(String(cfg.headers['cache-control']), /s-maxage=600/);
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(health.headers['cache-control'], undefined);
  });

  it('search_text wird beim Upsert gesetzt', async () => {
    const rows = await listingsRepo.byIds(['mock:jp1']);
    assert.equal(rows.length, 1);
    const { query } = await import('../src/db.js');
    const r = await query<{ search_text: string }>('SELECT search_text FROM listings WHERE id = ?', ['mock:jp1']);
    assert.match(r[0].search_text, /toyota land cruiser 70 .* nagoya 41208 uss nagoya/);
  });
});
