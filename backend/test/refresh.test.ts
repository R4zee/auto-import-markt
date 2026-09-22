import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

process.env.DATABASE_PATH = ':memory:';
delete process.env.TURSO_DATABASE_URL;
delete process.env.DATABASE_URL;
process.env.VERCEL = '';
process.env.REFERENCE_ENABLED = 'true';

const { closeDb, one, ready, run } = await import('../src/db.js');
const { listingsRepo } = await import('../src/repositories/listings.js');
const { addPendingCandidates, refKeyFor } = await import('../src/services/reference.js');
const { listingId } = await import('../src/providers/types.js');
import type { Listing } from '../src/domain/types.js';
import type { RefQuery } from '../src/providers/mobilede.js';

function listing(ext: string, over: Partial<Listing> = {}): Listing {
  return {
    id: listingId('olx-pl', ext), source: 'olx-pl', externalId: ext, market: 'EE', country: 'pl', location: 'Warszawa',
    offerType: 'fixed', url: null, year: 2015, make: 'BMW', model: '3 Series', trim: '320d Touring F31, Automatik', km: 120_000, engine: '2.0 L', engineCcm: 1995,
    co2Gkm: null, transmission: 'Automatic', drive: 'RWD', fuel: 'Diesel', price: 60_000, currency: 'PLN', steering: 'LHD', auction: null,
    coc: true, classic: false, dutyRateOverride: null, originProof: true, resaleEur: null, partnerId: '', photos: [], photoCount: 0,
    damage: [], fetchedAt: '2026-09-22T00:00:00.000Z', active: true, powerKw: 140, ...over,
  };
}

describe('Vergleichspreis-Job: offene Inserate als Bucket-Kandidaten', async () => {
  await ready();
  after(async () => { await closeDb(); });

  it('ergänzt den Bucket eines offenen Inserats, dessen Schlüssel die SQL-Gruppierung nicht liefert', async () => {
    const l = listing('1');
    await listingsRepo.upsertMany([l]);
    const row = await one<{ ref_key: string; ref_min_eur: number | null }>('SELECT ref_key, ref_min_eur FROM listings WHERE id = ?', [l.id]);
    assert.equal(row?.ref_key, refKeyFor(l));
    assert.ok(row?.ref_key, 'Schlüssel gesetzt');
    assert.equal(row?.ref_min_eur, null, 'offen');

    const wanted = new Map<string, { q: RefQuery; n: number }>();
    assert.equal(await addPendingCandidates(wanted), 1);
    const c = wanted.get(row!.ref_key);
    assert.ok(c, 'Bucket unter dem Schlüssel des Inserats');
    assert.equal(c.n, 1);
    assert.equal(c.q.make, 'BMW');
    // Baureihen-Code F31 hinter dem ersten Ausstattungswort → Bauzeitraum statt Baujahr ±1
    assert.ok(c.q.yearFrom < 2014, `Bauzeitraum der Baureihe (${c.q.yearFrom}–${c.q.yearTo})`);

    // Bereits bekannter Bucket: nur zählen, nichts ergänzen
    assert.equal(await addPendingCandidates(wanted), 0);
    assert.equal(wanted.get(row!.ref_key)?.n, 2);
  });

  it('überspringt berechnete Inserate und Schlüssel aus einer älteren Bucket-Logik', async () => {
    const done = listing('2', { model: 'X5', trim: 'xDrive30d' });
    const stale = listing('3', { model: 'X3', trim: 'xDrive20d' });
    await listingsRepo.upsertMany([done, stale]);
    await run('UPDATE listings SET ref_min_eur = 25000 WHERE id = ?', [done.id]);
    await run("UPDATE listings SET ref_key = 'mobilede|bmw|alt|Diesel|2014-2016|kmall' WHERE id = ?", [stale.id]);
    const wanted = new Map<string, { q: RefQuery; n: number }>();
    // nur das offene Inserat aus dem ersten Test zählt
    assert.equal(await addPendingCandidates(wanted), 1);
    assert.equal(wanted.size, 1);
    assert.ok(!wanted.has('mobilede|bmw|alt|Diesel|2014-2016|kmall'));
  });
});
