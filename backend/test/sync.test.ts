import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

process.env.DATABASE_PATH = ':memory:';
delete process.env.TURSO_DATABASE_URL;
delete process.env.DATABASE_URL;
process.env.ENABLE_MOCK_PROVIDER = 'false';
process.env.ENCAR_ENABLED = 'false';
process.env.VERCEL = '';
process.env.FX_BASE_URL = 'http://127.0.0.1:1';

const { closeDb, query, ready, run } = await import('../src/db.js');
const { listingsRepo } = await import('../src/repositories/listings.js');
const { canonicalizeStoredMakes, syncProvider } = await import('../src/services/sync.js');
const { listingId } = await import('../src/providers/types.js');

import type { Listing } from '../src/domain/types.js';
import type { MarketProvider, ProviderResult } from '../src/providers/types.js';

const NOW = '2026-09-15T08:00:00.000Z';

function listing(source: string, ext: string, over: Partial<Listing> = {}): Listing {
  return {
    id: listingId(source, ext), source, externalId: ext, market: 'EE', country: source.split('-')[1] ?? 'pl', location: 'Warszawa',
    offerType: 'fixed', url: null, year: 2019, make: 'BMW', model: '320d', trim: '', km: 80_000, engine: '2.0 L', engineCcm: 1995,
    co2Gkm: null, transmission: 'Automatic', drive: 'RWD', fuel: 'Diesel', price: 90_000, currency: 'PLN', steering: 'LHD', auction: null,
    coc: true, classic: false, dutyRateOverride: null, originProof: true, resaleEur: null, partnerId: '', photos: [], photoCount: 0,
    damage: [], fetchedAt: NOW, active: true, ...over,
  };
}

/** Provider mit Teilquellen wie OLX: id "olx", Inserate unter olx-pl / olx-ro */
class FakeOlx implements MarketProvider {
  readonly id = 'olx';
  readonly label = 'Fake OLX';
  result: ProviderResult = { listings: [], complete: false };
  enabled(): boolean { return true; }
  async fetchAll(): Promise<ProviderResult> { return this.result; }
}

describe('Sync: Teilquellen, Duplikate und unveränderte Inserate', async () => {
  await ready();
  const p = new FakeOlx();
  after(async () => { await closeDb(); });

  it('erster Lauf schreibt jede ID einmal – doppelte (beworbene) Anzeigen werden zusammengeführt', async () => {
    p.result = {
      complete: false,
      listings: [listing('olx-pl', '1'), listing('olx-pl', '2'), listing('olx-ro', '7', { currency: 'EUR', price: 15_000 }), listing('olx-pl', '1')],
    };
    const r = await syncProvider(p);
    assert.equal(r.status, 'ok');
    assert.equal(r.upserted, 3);
    assert.ok(r.warnings?.includes('1 Duplikate zusammengeführt'), JSON.stringify(r.warnings));
    assert.deepEqual(await listingsRepo.countBySource(), { 'olx-pl': 2, 'olx-ro': 1 });
  });

  it('zweiter Lauf ohne Änderungen schreibt nichts – Vergleich findet die Teilquellen olx-pl/olx-ro', async () => {
    p.result = { complete: false, listings: [listing('olx-pl', '1'), listing('olx-pl', '2'), listing('olx-ro', '7', { currency: 'EUR', price: 15_000 })] };
    const r = await syncProvider(p);
    assert.equal(r.upserted, 0);
    assert.ok(r.warnings?.includes('3 unverändert übersprungen'), JSON.stringify(r.warnings));
  });

  it('Preisänderung wird geschrieben, Rechtslenker werden ignoriert', async () => {
    p.result = {
      complete: false,
      listings: [listing('olx-pl', '1', { price: 85_000 }), listing('olx-pl', '2'), listing('olx-ro', '7', { currency: 'EUR', price: 15_000 }), listing('olx-pl', '9', { steering: 'RHD' })],
    };
    const r = await syncProvider(p);
    assert.equal(r.upserted, 1);
    assert.deepEqual(await listingsRepo.countBySource(), { 'olx-pl': 2, 'olx-ro': 1 });
  });

  it('vollständiger Bestand deaktiviert fehlende Inserate über alle Teilquellen', async () => {
    p.result = { complete: true, listings: [listing('olx-pl', '2')] };
    const r = await syncProvider(p);
    assert.equal(r.deactivated, 2);
    assert.deepEqual(await listingsRepo.countBySource(), { 'olx-pl': 1 });
  });

  it('Markennamen werden beim Import vereinheitlicht', async () => {
    p.result = { complete: true, listings: [listing('olx-pl', '4', { make: 'MERCEDES-BENZ', model: 'E 220' }), listing('olx-ro', '5', { make: 'Mercedes', model: 'C 200' })] };
    const r = await syncProvider(p);
    assert.equal(r.upserted, 2);
    assert.equal(r.deactivated, 1, 'olx-pl:2 fehlt im vollständigen Bestand');
    const rows = await query<{ make: string; search_text: string }>("SELECT make, search_text FROM listings WHERE active = 1 ORDER BY id");
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((x) => x.make), ['Mercedes-Benz', 'Mercedes-Benz']);
    assert.ok(rows.every((x) => x.search_text.startsWith('mercedes-benz ')), JSON.stringify(rows));
  });

  it('Bestandskorrektur vereinheitlicht bereits gespeicherte Marken samt Suchspalte', async () => {
    await run("UPDATE listings SET make = 'Mercedes', search_text = 'mercedes e 220  warszawa' WHERE id = ?", [listingId('olx-pl', '4')]);
    await run("UPDATE listings SET make = 'VW' WHERE id = ?", [listingId('olx-ro', '5')]);
    const r = await canonicalizeStoredMakes();
    assert.deepEqual(r, { listings: 2, makes: 2 });
    const rows = await query<{ id: string; make: string; search_text: string }>('SELECT id, make, search_text FROM listings WHERE active = 1 ORDER BY id');
    assert.equal(rows[0].make, 'Mercedes-Benz');
    assert.ok(rows[0].search_text.startsWith('mercedes-benz e 220'), rows[0].search_text);
    assert.equal(rows[1].make, 'Volkswagen');
    assert.ok(rows[1].search_text.startsWith('volkswagen c 200'), rows[1].search_text);
    assert.deepEqual(await canonicalizeStoredMakes(), { listings: 0, makes: 0 }, 'zweiter Lauf ändert nichts');
  });
});
