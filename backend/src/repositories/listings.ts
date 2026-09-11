import type { InStatement } from '@libsql/client';
import { db, one, query, run, type Row } from '../db.ts';
import type { Listing, Partner } from '../domain/types.ts';

interface ListingRow extends Row {
  id: string; source: string; external_id: string; market: string; country: string; location: string;
  offer_type: string; url: string | null; year: number; make: string; model: string; trim: string; km: number;
  engine: string; engine_ccm: number | null; co2_gkm: number | null; transmission: string; drive: string; fuel: string;
  price: number; currency: string; steering: string; auction_json: string | null; coc: number; classic: number;
  duty_rate_override: number | null; origin_proof: number; resale_eur: number | null; partner_id: string;
  photos_json: string; photo_count: number; damage_json: string; fetched_at: string; active: number;
}

function rowToListing(r: ListingRow): Listing {
  return {
    id: r.id,
    source: r.source,
    externalId: r.external_id,
    market: r.market as Listing['market'],
    country: r.country,
    location: r.location,
    offerType: r.offer_type as Listing['offerType'],
    url: r.url,
    year: Number(r.year),
    make: r.make,
    model: r.model,
    trim: r.trim,
    km: Number(r.km),
    engine: r.engine,
    engineCcm: r.engine_ccm == null ? null : Number(r.engine_ccm),
    co2Gkm: r.co2_gkm == null ? null : Number(r.co2_gkm),
    transmission: r.transmission as Listing['transmission'],
    drive: r.drive as Listing['drive'],
    fuel: r.fuel as Listing['fuel'],
    price: Number(r.price),
    currency: r.currency,
    steering: r.steering as Listing['steering'],
    auction: r.auction_json ? JSON.parse(r.auction_json) : null,
    coc: !!r.coc,
    classic: !!r.classic,
    dutyRateOverride: r.duty_rate_override == null ? null : Number(r.duty_rate_override),
    originProof: !!r.origin_proof,
    resaleEur: r.resale_eur == null ? null : Number(r.resale_eur),
    partnerId: r.partner_id,
    photos: JSON.parse(r.photos_json),
    photoCount: Number(r.photo_count),
    damage: JSON.parse(r.damage_json),
    fetchedAt: r.fetched_at,
    active: !!r.active,
  };
}

const UPSERT = `
INSERT INTO listings (
  id, source, external_id, market, country, location, offer_type, url, year, make, model, trim, km, engine,
  engine_ccm, co2_gkm, transmission, drive, fuel, price, currency, steering, auction_json, coc, classic,
  duty_rate_override, origin_proof, resale_eur, partner_id, photos_json, photo_count, damage_json, fetched_at, active
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
ON CONFLICT(id) DO UPDATE SET
  market = excluded.market, country = excluded.country, location = excluded.location, offer_type = excluded.offer_type,
  url = excluded.url, year = excluded.year, make = excluded.make, model = excluded.model, trim = excluded.trim,
  km = excluded.km, engine = excluded.engine, engine_ccm = excluded.engine_ccm, co2_gkm = excluded.co2_gkm,
  transmission = excluded.transmission, drive = excluded.drive, fuel = excluded.fuel, price = excluded.price,
  currency = excluded.currency, steering = excluded.steering, auction_json = excluded.auction_json, coc = excluded.coc,
  classic = excluded.classic, duty_rate_override = excluded.duty_rate_override, origin_proof = excluded.origin_proof,
  resale_eur = excluded.resale_eur, partner_id = excluded.partner_id, photos_json = excluded.photos_json,
  photo_count = excluded.photo_count, damage_json = excluded.damage_json, fetched_at = excluded.fetched_at, active = 1
`;

function upsertStatement(l: Listing): InStatement {
  return {
    sql: UPSERT,
    args: [
      l.id, l.source, l.externalId, l.market, l.country, l.location, l.offerType, l.url, l.year, l.make, l.model, l.trim,
      l.km, l.engine, l.engineCcm, l.co2Gkm, l.transmission, l.drive, l.fuel, l.price, l.currency, l.steering,
      l.auction ? JSON.stringify(l.auction) : null, l.coc ? 1 : 0, l.classic ? 1 : 0, l.dutyRateOverride,
      l.originProof ? 1 : 0, l.resaleEur, l.partnerId, JSON.stringify(l.photos), l.photoCount, JSON.stringify(l.damage), l.fetchedAt,
    ],
  };
}

export const listingsRepo = {
  async upsertMany(listings: Listing[]): Promise<number> {
    if (!listings.length) return 0;
    // in Blöcken, damit auch große Syncs in einer Transaktion je Block bleiben
    for (let i = 0; i < listings.length; i += 200) {
      await db().batch(listings.slice(i, i + 200).map(upsertStatement), 'write');
    }
    return listings.length;
  },

  /** Deaktiviert alle Listings einer Quelle, die nicht in `keepIds` enthalten sind. */
  async deactivateMissing(source: string, keepIds: string[]): Promise<number> {
    const rows = await query<{ id: string }>('SELECT id FROM listings WHERE source = ? AND active = 1', [source]);
    const keep = new Set(keepIds);
    const stale = rows.map((r) => r.id).filter((id) => !keep.has(id));
    if (!stale.length) return 0;
    await db().batch(stale.map((id) => ({ sql: 'UPDATE listings SET active = 0 WHERE id = ?', args: [id] })), 'write');
    return stale.length;
  },

  async allActive(): Promise<Listing[]> {
    return (await query<ListingRow>('SELECT * FROM listings WHERE active = 1')).map(rowToListing);
  },

  async byId(id: string): Promise<Listing | null> {
    const row = await one<ListingRow>('SELECT * FROM listings WHERE id = ?', [id]);
    return row ? rowToListing(row) : null;
  },

  async byIds(ids: string[]): Promise<Listing[]> {
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    return (await query<ListingRow>(`SELECT * FROM listings WHERE id IN (${placeholders})`, ids)).map(rowToListing);
  },

  async countBySource(): Promise<Record<string, number>> {
    const rows = await query<{ source: string; n: number }>('SELECT source, COUNT(*) AS n FROM listings WHERE active = 1 GROUP BY source');
    return Object.fromEntries(rows.map((r) => [r.source, Number(r.n)]));
  },
};

interface PartnerRow extends Row { id: string; name: string; note: string; markets: string; email: string | null }
const toPartner = (r: PartnerRow): Partner => ({ id: r.id, name: r.name, note: r.note, markets: JSON.parse(r.markets), email: r.email });

export const partnersRepo = {
  async upsertMany(partners: Partner[]): Promise<void> {
    if (!partners.length) return;
    await db().batch(
      partners.map((p) => ({
        sql: 'INSERT INTO partners(id, name, note, markets, email) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, note = excluded.note, markets = excluded.markets, email = excluded.email',
        args: [p.id, p.name, p.note, JSON.stringify(p.markets), p.email],
      })),
      'write',
    );
  },
  async all(): Promise<Partner[]> {
    return (await query<PartnerRow>('SELECT * FROM partners')).map(toPartner);
  },
  async byId(id: string): Promise<Partner | null> {
    const r = await one<PartnerRow>('SELECT * FROM partners WHERE id = ?', [id]);
    return r ? toPartner(r) : null;
  },
};

export { run };
