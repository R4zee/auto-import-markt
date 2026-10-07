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
const { kmBandFor, kmBandSql } = await import('../src/services/reference.js');
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
    // olx-pl:2 mit anderem km-Stand: zwei IDs mit identischem Fahrzeug gälten sonst als Dublette (siehe unten)
    p.result = {
      complete: false,
      listings: [listing('olx-pl', '1'), listing('olx-pl', '2', { km: 95_000 }), listing('olx-ro', '7', { currency: 'EUR', price: 15_000 }), listing('olx-pl', '1')],
    };
    const r = await syncProvider(p);
    assert.equal(r.status, 'ok');
    assert.equal(r.upserted, 3);
    assert.ok(r.warnings?.includes('1 Duplikate zusammengeführt'), JSON.stringify(r.warnings));
    assert.deepEqual(await listingsRepo.countBySource(), { 'olx-pl': 2, 'olx-ro': 1 });
  });

  it('zweiter Lauf ohne Änderungen schreibt nichts – Vergleich findet die Teilquellen olx-pl/olx-ro', async () => {
    p.result = { complete: false, listings: [listing('olx-pl', '1'), listing('olx-pl', '2', { km: 95_000 }), listing('olx-ro', '7', { currency: 'EUR', price: 15_000 })] };
    const r = await syncProvider(p);
    assert.equal(r.upserted, 0);
    assert.ok(r.warnings?.includes('3 unverändert übersprungen'), JSON.stringify(r.warnings));
  });

  it('Preisänderung wird geschrieben, Rechtslenker werden ignoriert', async () => {
    p.result = {
      complete: false,
      listings: [listing('olx-pl', '1', { price: 85_000 }), listing('olx-pl', '2', { km: 95_000 }), listing('olx-ro', '7', { currency: 'EUR', price: 15_000 }), listing('olx-pl', '9', { steering: 'RHD' })],
    };
    const r = await syncProvider(p);
    assert.equal(r.upserted, 1);
    assert.deepEqual(await listingsRepo.countBySource(), { 'olx-pl': 2, 'olx-ro': 1 });
  });

  it('vollständiger Bestand deaktiviert fehlende Inserate über alle Teilquellen', async () => {
    p.result = { complete: true, listings: [listing('olx-pl', '2', { km: 95_000 })] };
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

  it('Laufleistungsband in SQL entspricht kmBandFor() (Refresh-Job und Auslieferung finden denselben Bucket)', async () => {
    const kms = [0, 9_999, 33_333, 50_000, 66_667, 80_000, 99_999, 100_000, 123_456, 150_000, 192_307, 192_308, 230_769, 230_770, 250_000, 400_000];
    const rows = await query<{ km: number; band: number | null }>(`SELECT km, ${kmBandSql()} AS band FROM (${kms.map((k) => `SELECT ${k} AS km`).join(' UNION ALL ')})`);
    for (const r of rows) assert.equal(r.band == null ? null : Number(r.band), kmBandFor(Number(r.km)), `km=${r.km}`);
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

  const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString();

  it('ohne Vollabgleich: seit über SYNC_STALE_DAYS nicht gelieferte Inserate werden deaktiviert, jüngere bleiben', async () => {
    // Bestand: olx-pl:4 (zuletzt vor 10 Tagen abgerufen) und olx-ro:5 (vor 2 Tagen); der Lauf liefert nur olx-pl:8 neu
    await run('UPDATE listings SET fetched_at = ? WHERE id = ?', [daysAgo(10), listingId('olx-pl', '4')]);
    await run('UPDATE listings SET fetched_at = ? WHERE id = ?', [daysAgo(2), listingId('olx-ro', '5')]);
    p.result = { complete: false, listings: [listing('olx-pl', '8')] };
    const r = await syncProvider(p);
    assert.equal(r.upserted, 1);
    assert.equal(r.deactivated, 1, 'nur olx-pl:4 ist älter als 7 Tage');
    assert.ok(r.warnings?.some((w) => w.startsWith('1 seit über 7 Tagen nicht mehr geliefert')), JSON.stringify(r.warnings));
    assert.deepEqual(await listingsRepo.countBySource(), { 'olx-pl': 1, 'olx-ro': 1 });
    const gone = await query<{ id: string; active: number }>('SELECT id, active FROM listings WHERE id = ?', [listingId('olx-pl', '4')]);
    assert.equal(Number(gone[0].active), 0);
  });

  it('ohne Vollabgleich: ein leerer Lauf deaktiviert nichts', async () => {
    await run('UPDATE listings SET fetched_at = ? WHERE id = ?', [daysAgo(30), listingId('olx-ro', '5')]);
    p.result = { complete: false, listings: [] };
    const r = await syncProvider(p);
    assert.equal(r.deactivated, 0);
    assert.deepEqual(await listingsRepo.countBySource(), { 'olx-pl': 1, 'olx-ro': 1 });
  });

  it('weiter gelieferte, unveränderte Inserate bekommen die Abrufzeit nachgeführt (älter als TOUCH_AFTER_DAYS)', async () => {
    const { TOUCH_AFTER_DAYS } = await import('../src/services/sync.js');
    await run('UPDATE listings SET fetched_at = ? WHERE id = ?', [daysAgo(TOUCH_AFTER_DAYS + 2), listingId('olx-pl', '8')]);
    await run('UPDATE listings SET fetched_at = ? WHERE id = ?', [daysAgo(1), listingId('olx-ro', '5')]);
    const before = Date.now();
    // olx-ro:5 wurde als Mercedes C 200 angelegt (Preis/km unverändert) – Marke spielt für „unverändert“ keine Rolle
    p.result = { complete: false, listings: [listing('olx-pl', '8'), listing('olx-ro', '5', { make: 'Mercedes', model: 'C 200' })] };
    const r = await syncProvider(p);
    assert.equal(r.upserted, 0, 'nichts geändert → kein Upsert');
    assert.equal(r.deactivated, 0);
    assert.ok(r.warnings?.includes('1 Abrufzeit nachgeführt'), JSON.stringify(r.warnings));
    const rows = await query<{ id: string; fetched_at: string }>('SELECT id, fetched_at FROM listings WHERE active = 1 ORDER BY id');
    const pl8 = rows.find((x) => x.id === listingId('olx-pl', '8'))!;
    const ro5 = rows.find((x) => x.id === listingId('olx-ro', '5'))!;
    assert.ok(Date.parse(pl8.fetched_at) >= before - 1000, `olx-pl:8 nachgeführt: ${pl8.fetched_at}`);
    assert.ok(Date.parse(ro5.fetched_at) < before - 12 * 3600000, `olx-ro:5 (1 Tag) bleibt: ${ro5.fetched_at}`);
    // der Lauf gilt nun als frisch – ein zweiter Lauf führt nichts nach
    const again = await syncProvider(p);
    assert.ok(!again.warnings?.some((w) => w.endsWith('Abrufzeit nachgeführt')), JSON.stringify(again.warnings));
  });

  it('Dubletten innerhalb einer Quelle (gleiches Fahrzeug unter neuer ID): nur das jüngste Inserat bleibt aktiv', async () => {
    // zwei neue IDs mit identischem Fahrzeug (gleiche Abrufzeit → die später eingefügte Zeile bleibt), dazu ein
    // drittes mit anderem Preis, das nicht als Dublette gilt
    p.result = { complete: false, listings: [listing('olx-pl', '20', { km: 123_456, price: 77_000 }), listing('olx-pl', '21', { km: 123_456, price: 77_000 }), listing('olx-pl', '22', { km: 123_456, price: 76_000 })] };
    const r = await syncProvider(p);
    assert.equal(r.upserted, 3);
    assert.equal(r.deactivated, 1, JSON.stringify(r.warnings));
    assert.ok(r.warnings?.includes('1 Dubletten (gleiches Fahrzeug unter neuer ID) deaktiviert'), JSON.stringify(r.warnings));
    const rows = await query<{ id: string; active: number }>("SELECT id, active FROM listings WHERE km = 123456 ORDER BY id");
    assert.deepEqual(rows.map((x) => [x.id, Number(x.active)]), [[listingId('olx-pl', '20'), 0], [listingId('olx-pl', '21'), 1], [listingId('olx-pl', '22'), 1]]);
    // Die deaktivierte ID 20 kommt mit jüngerer Abrufzeit zurück (Upsert reaktiviert sie), 21 unverändert (Abrufzeit wird
    // auf den Laufbeginn nachgeführt, liegt also vor der von 20) → 20 bleibt, 21 geht; 22 (Stand 15.09.) fehlt → Altersregel
    p.result = { complete: false, listings: [listing('olx-pl', '20', { km: 123_456, price: 77_000, fetchedAt: new Date(Date.now() + 3600000).toISOString() }), listing('olx-pl', '21', { km: 123_456, price: 77_000 })] };
    const again = await syncProvider(p);
    assert.equal(again.deactivated, 2, JSON.stringify(again.warnings));
    assert.ok(again.warnings?.includes('1 Dubletten (gleiches Fahrzeug unter neuer ID) deaktiviert'), JSON.stringify(again.warnings));
    const after = await query<{ id: string; active: number }>("SELECT id, active FROM listings WHERE km = 123456 ORDER BY id");
    assert.deepEqual(after.map((x) => [x.id, Number(x.active)]), [[listingId('olx-pl', '20'), 1], [listingId('olx-pl', '21'), 0], [listingId('olx-pl', '22'), 0]]);
  });

  it('touchIds: nur unveränderte, alte Inserate; über TOUCH_MAX hinaus die ältesten zuerst', async () => {
    const { touchIds, TOUCH_MAX, staleIds } = await import('../src/services/sync.js');
    const existing = new Map<string, { price: number; km: number; fetchedAt: string }>();
    const delivered: Listing[] = [];
    for (let i = 0; i < TOUCH_MAX + 5; i++) {
      const id = listingId('x', String(i));
      // Nr. 0 jüngst, dann absteigend älter: Nr. i wurde vor i+10 Tagen abgerufen
      existing.set(id, { price: 1, km: 1, fetchedAt: daysAgo(i + 10) });
      delivered.push(listing('x', String(i), { price: i === 1 ? 2 : 1, km: 1 }));
    }
    existing.set(listingId('x', '0'), { price: 1, km: 1, fetchedAt: daysAgo(0) }); // frisch → nicht fällig
    const isChanged = (l: Listing) => existing.get(l.id)?.price !== l.price;
    const ids = touchIds(delivered, existing, isChanged, daysAgo(3));
    assert.equal(ids.length, TOUCH_MAX);
    assert.ok(!ids.includes(listingId('x', '0')), 'frisch');
    assert.ok(!ids.includes(listingId('x', '1')), 'geändert → Upsert schreibt fetched_at ohnehin');
    assert.equal(ids[0], listingId('x', String(TOUCH_MAX + 4)), 'ältestes zuerst');
    // staleIds: fehlende, alte Inserate
    const seen = new Set(delivered.slice(0, 3).map((l) => l.id));
    const stale = staleIds(existing, seen, daysAgo(7));
    assert.equal(stale.length, TOUCH_MAX + 5 - 3);
    assert.ok(!stale.includes(listingId('x', '2')) && stale.includes(listingId('x', '3')));
  });
});

describe('Kursnachzug nur bei spürbarer Kursänderung (Turso-Schreibkontingent)', async () => {
  const { currenciesToRecompute, FX_RECOMPUTE_THRESHOLD } = await import('../src/services/sync.js');
  const current = { EUR: 1, USD: 0.87, JPY: 0.0058, KRW: 0.00064 };
  it('ohne gespeicherten Stand oder nach Kalkulationsänderung alles', () => {
    assert.equal(currenciesToRecompute(current, null), 'all');
    assert.equal(currenciesToRecompute(current, { version: '1', rates: current }), 'all');
  });
  it('nur Währungen mit Abweichung ab der Schwelle, EUR nie', () => {
    assert.deepEqual(currenciesToRecompute(current, { version: '2', rates: current }), []);
    const moved = { ...current, USD: 0.87 * (1 + FX_RECOMPUTE_THRESHOLD + 0.001), JPY: 0.0058 * 1.001 };
    assert.deepEqual(currenciesToRecompute(moved, { version: '2', rates: current }), ['USD']);
    assert.deepEqual(currenciesToRecompute({ ...current, AED: 0.24 }, { version: '2', rates: current }), ['AED'], 'neue Währung ohne Stand');
  });
});
