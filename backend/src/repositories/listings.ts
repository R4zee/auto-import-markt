import type { InStatement, InValue } from '@libsql/client';
import { db, one, query, refDiffSql, run, type Row } from '../db.js';
import { calcLandedCost } from '../domain/landedCost.js';
import { DEST_CODES } from '../domain/markets.js';
import type { DestCode, Listing, ListingQuery, Partner } from '../domain/types.js';
import { fxSync } from '../services/fx.js';
import { refKeyFor } from '../services/reference.js';

interface ListingRow extends Row {
  id: string; source: string; external_id: string; market: string; country: string; location: string;
  offer_type: string; url: string | null; year: number; make: string; model: string; trim: string; km: number;
  engine: string; engine_ccm: number | null; power_kw: number | null; co2_gkm: number | null; transmission: string; drive: string; fuel: string;
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
    powerKw: r.power_kw == null ? null : Number(r.power_kw),
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

/** Vorberechnete EUR- und Endpreis-Spalten (für SQL-Filter/-Sortierung); Kurse aus dem FX-Cache. */
function precompute(l: Pick<Listing, 'market' | 'price' | 'currency' | 'classic' | 'dutyRateOverride' | 'originProof'>): { priceEur: number | null; landed: Record<DestCode, number | null> } {
  const rate = fxSync().rates[l.currency.toUpperCase()];
  const landed = { DE: null, AT: null, NL: null, PL: null } as Record<DestCode, number | null>;
  if (rate == null) return { priceEur: null, landed };
  for (const dest of DEST_CODES) {
    landed[dest] = calcLandedCost({
      market: l.market, price: l.price, currency: l.currency, classic: l.classic,
      dutyRateOverride: l.dutyRateOverride, originProof: l.originProof, dest, fxRate: rate,
    }).totalEur;
  }
  return { priceEur: Math.round(l.price * rate * 100) / 100, landed };
}

/** Suchtext wie in db.ts (SEARCH_TEXT_SQL), hier in JS für den Upsert. */
export function searchText(l: Listing): string {
  return [l.make, l.model, l.trim, l.location, l.auction?.lot ?? '', l.auction?.house ?? ''].join(' ').toLowerCase();
}

const UPSERT = `
INSERT INTO listings (
  id, source, external_id, market, country, location, offer_type, url, year, make, model, trim, km, engine,
  engine_ccm, co2_gkm, transmission, drive, fuel, price, currency, steering, auction_json, coc, classic,
  duty_rate_override, origin_proof, resale_eur, partner_id, photos_json, photo_count, damage_json, fetched_at, active,
  price_eur, landed_de, landed_at, landed_nl, landed_pl, auction_ends_at, search_text, power_kw, ref_key
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  market = excluded.market, country = excluded.country, location = excluded.location, offer_type = excluded.offer_type,
  url = excluded.url, year = excluded.year, make = excluded.make, model = excluded.model, trim = excluded.trim,
  km = excluded.km, engine = excluded.engine, engine_ccm = excluded.engine_ccm, co2_gkm = excluded.co2_gkm,
  transmission = excluded.transmission, drive = excluded.drive, fuel = excluded.fuel, price = excluded.price,
  currency = excluded.currency, steering = excluded.steering, auction_json = excluded.auction_json, coc = excluded.coc,
  classic = excluded.classic, duty_rate_override = excluded.duty_rate_override, origin_proof = excluded.origin_proof,
  resale_eur = excluded.resale_eur, partner_id = excluded.partner_id, photos_json = excluded.photos_json,
  photo_count = excluded.photo_count, damage_json = excluded.damage_json, fetched_at = excluded.fetched_at, active = 1,
  price_eur = excluded.price_eur, landed_de = excluded.landed_de, landed_at = excluded.landed_at,
  landed_nl = excluded.landed_nl, landed_pl = excluded.landed_pl, auction_ends_at = excluded.auction_ends_at,
  search_text = excluded.search_text, power_kw = excluded.power_kw,
  -- Vergleichspreis-Spalten: bleibt der Bucket gleich, Abstände mit dem neuen Endpreis nachziehen; sonst bis zum
  -- nächsten Vergleichspreis-Lauf leer (IS vergleicht NULL-sicher)
  ref_key = excluded.ref_key,
  ref_min_eur = CASE WHEN excluded.ref_key IS listings.ref_key THEN listings.ref_min_eur ELSE NULL END,
  ${DEST_CODES.map((d) => `ref_diff_${d.toLowerCase()} = CASE WHEN excluded.ref_key IS listings.ref_key THEN ${refDiffSql(`excluded.landed_${d.toLowerCase()}`, 'listings.ref_min_eur')} ELSE NULL END`).join(',\n  ')}
`;

function upsertStatement(l: Listing): InStatement {
  const pre = precompute(l);
  return {
    sql: UPSERT,
    args: [
      l.id, l.source, l.externalId, l.market, l.country, l.location, l.offerType, l.url, l.year, l.make, l.model, l.trim,
      l.km, l.engine, l.engineCcm, l.co2Gkm, l.transmission, l.drive, l.fuel, l.price, l.currency, l.steering,
      l.auction ? JSON.stringify(l.auction) : null, l.coc ? 1 : 0, l.classic ? 1 : 0, l.dutyRateOverride,
      l.originProof ? 1 : 0, l.resaleEur, l.partnerId, JSON.stringify(l.photos), l.photoCount, JSON.stringify(l.damage), l.fetchedAt,
      pre.priceEur, pre.landed.DE, pre.landed.AT, pre.landed.NL, pre.landed.PL, l.auction?.endsAt ?? null, searchText(l), l.powerKw ?? null, refKeyFor(l),
    ],
  };
}

const AUTOMATIC_LIKE = ['Automatic', 'PDK', 'Single speed'];
const LANDED_COL: Record<DestCode, string> = { DE: 'landed_de', AT: 'landed_at', NL: 'landed_nl', PL: 'landed_pl' };
/** Abstand des Endpreises zum günstigsten DE-Vergleichsangebot (Prozent) je Zielland – schreibt der Vergleichspreis-Job */
const REF_DIFF_COL: Record<DestCode, string> = { DE: 'ref_diff_de', AT: 'ref_diff_at', NL: 'ref_diff_nl', PL: 'ref_diff_pl' };

/**
 * Spalten der Trefferliste: alles außer der vollen Fotoliste – die Karte zeigt nur das erste Foto,
 * alle Fotos liefert die Detailansicht. Spart je Seite mehrere hundert KB Transfer aus Turso.
 */
const LIST_COLUMN_NAMES = ['id', 'source', 'external_id', 'market', 'country', 'location', 'offer_type', 'url', 'year', 'make', 'model', 'trim', 'km', 'engine',
  'engine_ccm', 'power_kw', 'co2_gkm', 'transmission', 'drive', 'fuel', 'price', 'currency', 'steering', 'auction_json', 'coc', 'classic', 'duty_rate_override',
  'origin_proof', 'resale_eur', 'partner_id', 'photo_count', 'damage_json', 'fetched_at', 'active'];
function listColumns(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `${LIST_COLUMN_NAMES.map((c) => p + c).join(', ')}, CASE WHEN json_array_length(${p}photos_json) > 0 THEN json_array(json_extract(${p}photos_json, '$[0]')) ELSE '[]' END AS photos_json`;
}

export interface SqlSearchResult {
  items: Listing[];
  total: number;
  page: number;
  pageSize: number;
}

/** Vorberechnete Filterlisten (werden nach jedem Sync neu erzeugt, siehe services/facets.ts). */
export interface FacetData {
  makes: string[];
  /** Modelle je Marke (sortiert) */
  modelsByMake: Record<string, string[]>;
  /** Modelle über alle Marken (begrenzt) */
  models: string[];
  locations: string[];
  /** Anzahl je Markt: gesamt sowie je Angebotsart */
  marketCounts: { all: Record<string, number>; auction: Record<string, number>; fixed: Record<string, number> };
  total: number;
  computedAt: string;
}

/**
 * Bereichsfilter mit unärem Plus: SQLite darf dafür keinen Index wählen. Ohne das Plus nahm der Planer für
 * `year >= 1985` den (active, year)-Index, lief damit über den kompletten Bestand und las jede Zeile einzeln –
 * die Ursache für minutenlange Abfragen auf Turso. Gleichheitsfilter (Marke, Modell …) nutzen den abdeckenden Index.
 */
function buildWhere(q: ListingQuery, dest: DestCode): { whereSql: string; args: InValue[]; selective: boolean } {
  const where: string[] = ['active = 1'];
  const args: InValue[] = [];
  let selective = false;
  if (q.offer && q.offer !== 'all') { where.push('offer_type = ?'); args.push(q.offer); }
  if (q.markets?.length) { where.push(`market IN (${q.markets.map(() => '?').join(',')})`); args.push(...q.markets); }
  if (q.make) { where.push('make = ?'); args.push(q.make); selective = true; }
  if (q.model) { where.push('model = ?'); args.push(q.model); selective = true; }
  if (q.location) { where.push('location = ?'); args.push(q.location); }
  if (q.yearFrom != null) { where.push('+year >= ?'); args.push(q.yearFrom); }
  if (q.yearTo != null) { where.push('+year <= ?'); args.push(q.yearTo); }
  if (q.maxKm != null) { where.push('+km <= ?'); args.push(q.maxKm); }
  if (q.fuels?.length) { where.push(`fuel IN (${q.fuels.map(() => '?').join(',')})`); args.push(...q.fuels); }
  if (q.transmissions?.length) {
    const parts: string[] = [];
    if (q.transmissions.includes('Automatic')) { parts.push(`transmission IN (${AUTOMATIC_LIKE.map(() => '?').join(',')})`); args.push(...AUTOMATIC_LIKE); }
    if (q.transmissions.includes('Manual')) parts.push("transmission = 'Manual'");
    if (parts.length) where.push(`(${parts.join(' OR ')})`);
  }
  if (q.cocOnly) where.push('coc = 1');
  if (q.maxLandedEur != null) { where.push(`+${LANDED_COL[dest]} <= ?`); args.push(q.maxLandedEur); }
  const text = (q.q ?? '').trim().toLowerCase();
  if (text) {
    // search_text liegt im abdeckenden Index → Volltextsuche als Indexscan ohne Zeilenzugriffe
    where.push('search_text LIKE ?');
    args.push(`%${text.replace(/[%_]/g, ' ')}%`);
    selective = true;
  }
  return { whereSql: where.join(' AND '), args, selective };
}

function orderBy(sort: ListingQuery['sort'], dest: DestCode, alias = ''): string {
  const landedCol = `${alias}${LANDED_COL[dest]}`;
  const refCol = `${alias}${REF_DIFF_COL[dest]}`;
  return {
    'landed-asc': `${landedCol} ASC NULLS LAST, ${alias}price_eur ASC`,
    'landed-desc': `${landedCol} DESC NULLS LAST, ${alias}price_eur DESC`,
    'year-desc': `${alias}year DESC, ${alias}km ASC`,
    'km-asc': `${alias}km ASC, ${alias}year DESC`,
    'ending': `CASE WHEN ${alias}auction_ends_at IS NULL THEN 1 ELSE 0 END, ${alias}auction_ends_at ASC, ${alias}landed_de ASC`,
    // Inserate ohne Vergleichspreis zuletzt (NULLS LAST wie beim Endpreis; DESC stellt NULL in SQLite ohnehin nach hinten)
    'ref-asc': `${refCol} ASC NULLS LAST, ${landedCol} ASC`,
    'ref-desc': `${refCol} DESC NULLS LAST, ${landedCol} ASC`,
  }[sort ?? 'landed-asc'];
}

/** Quellenbedingung: nur die Quelle selbst oder zusätzlich ihre Teilquellen ("<id>-…"). */
function sourceClause(source: string, includeSubSources: boolean): { sql: string; args: InValue[] } {
  return includeSubSources
    ? { sql: '(source = ? OR source LIKE ?)', args: [source, `${source}-%`] }
    : { sql: 'source = ?', args: [source] };
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

  /**
   * Deaktiviert alle Listings einer Quelle, die nicht in `keepIds` enthalten sind.
   * `includeSubSources` nimmt auch Teilquellen des Providers mit ("olx" → olx-pl, olx-ro …, "autoapi" → autoapi-dubizzle).
   */
  async deactivateMissing(source: string, keepIds: string[], includeSubSources = false): Promise<number> {
    const src = sourceClause(source, includeSubSources);
    const rows = await query<{ id: string }>(`SELECT id FROM listings WHERE ${src.sql} AND active = 1`, src.args);
    const keep = new Set(keepIds);
    const stale = rows.map((r) => r.id).filter((id) => !keep.has(id));
    for (let i = 0; i < stale.length; i += 500) {
      await db().batch(stale.slice(i, i + 500).map((id) => ({ sql: 'UPDATE listings SET active = 0 WHERE id = ?', args: [id] })), 'write');
    }
    return stale.length;
  },

  /** Nur IDs (und Preis/km) einer Quelle – für Abgleiche ohne den ganzen Datensatz zu laden. */
  async activeIdsBySource(source: string, includeSubSources = false): Promise<Map<string, { price: number; km: number }>> {
    const src = sourceClause(source, includeSubSources);
    const rows = await query<{ id: string; price: number; km: number }>(`SELECT id, price, km FROM listings WHERE ${src.sql} AND active = 1`, src.args);
    return new Map(rows.map((r) => [r.id, { price: Number(r.price), km: Number(r.km) }]));
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

  /**
   * Suche/Filter/Sortierung/Paginierung in SQL – zwei Abfragen (Seite + Gesamtzahl), beide indexgestützt.
   * Filterlisten und Marktzähler kommen nicht mehr aus dieser Abfrage, sondern aus dem Facetten-Cache.
   */
  async search(q: ListingQuery, dest: DestCode): Promise<SqlSearchResult> {
    const { whereSql, args, selective } = buildWhere(q, dest);
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 48));
    const limitArgs: InValue[] = [pageSize, (page - 1) * pageSize];

    if (selective) {
      // Marken-/Modell-/Textfilter: Treffer komplett im abdeckenden Index ermitteln (Seek auf make/model bzw. Indexscan
      // für den Text), Gesamtzahl im selben Durchlauf per Fensterfunktion, danach nur die Zeilen der Seite lesen.
      const rows = await query<ListingRow & { total: number }>(
        `WITH hits AS (SELECT rowid AS rid, COUNT(*) OVER () AS total FROM listings WHERE ${whereSql} ORDER BY ${orderBy(q.sort, dest)} LIMIT ? OFFSET ?)
         SELECT ${listColumns('l')}, hits.total FROM hits JOIN listings l ON l.rowid = hits.rid ORDER BY ${orderBy(q.sort, dest, 'l.')}`,
        [...args, ...limitArgs],
      );
      // Seite hinter dem Ende: Gesamtzahl separat (kommt praktisch nur bei veralteten Links vor)
      const total = rows.length ? Number(rows[0].total) : Number((await one<{ n: number }>(`SELECT COUNT(*) AS n FROM listings WHERE ${whereSql}`, args))?.n ?? 0);
      return { items: rows.map(rowToListing), total, page, pageSize };
    }

    // Ohne selektiven Filter: geordneter Lauf über den Sortier-Index mit frühem Abbruch, Zählung über den abdeckenden Index
    const [rows, totalRow] = await Promise.all([
      query<ListingRow>(`SELECT ${listColumns()} FROM listings WHERE ${whereSql} ORDER BY ${orderBy(q.sort, dest)} LIMIT ? OFFSET ?`, [...args, ...limitArgs]),
      one<{ n: number }>(`SELECT COUNT(*) AS n FROM listings WHERE ${whereSql}`, args),
    ]);
    return { items: rows.map(rowToListing), total: Number(totalRow?.n ?? 0), page, pageSize };
  },

  /** Filterlisten und Marktzähler über den abdeckenden Index berechnen (nach jedem Sync, nicht je Anfrage). */
  async computeFacets(): Promise<FacetData> {
    const [makeModelRows, locRows, marketRows] = await Promise.all([
      query<{ make: string; model: string }>('SELECT DISTINCT make, model FROM listings WHERE active = 1 ORDER BY make, model'),
      query<{ location: string }>("SELECT DISTINCT location FROM listings WHERE active = 1 AND location <> '' ORDER BY location LIMIT 300"),
      query<{ market: string; offer_type: string; n: number }>('SELECT market, offer_type, COUNT(*) AS n FROM listings WHERE active = 1 GROUP BY market, offer_type'),
    ]);
    const modelsByMake: Record<string, string[]> = {};
    for (const r of makeModelRows) (modelsByMake[r.make] ??= []).push(r.model);
    const marketCounts: FacetData['marketCounts'] = { all: {}, auction: {}, fixed: {} };
    let total = 0;
    for (const r of marketRows) {
      const n = Number(r.n);
      total += n;
      marketCounts.all[r.market] = (marketCounts.all[r.market] ?? 0) + n;
      const byOffer = r.offer_type === 'auction' ? marketCounts.auction : marketCounts.fixed;
      byOffer[r.market] = (byOffer[r.market] ?? 0) + n;
    }
    return {
      makes: Object.keys(modelsByMake),
      modelsByMake,
      models: Array.from(new Set(makeModelRows.map((r) => r.model))).sort((a, b) => a.localeCompare(b)).slice(0, 400),
      locations: locRows.map((r) => r.location),
      marketCounts,
      total,
      computedAt: new Date().toISOString(),
    };
  },

  /** Vorberechnete EUR/Endpreis-Spalten mit aktuellen Kursen neu berechnen (z. B. nach Kursänderung). */
  async recomputeDerived(source?: string): Promise<number> {
    // nur die Spalten lesen, die die Kalkulation braucht – nicht Fotos/Schäden
    const rows = await query<{ id: string; market: string; price: number; currency: string; classic: number; duty_rate_override: number | null; origin_proof: number }>(
      `SELECT id, market, price, currency, classic, duty_rate_override, origin_proof FROM listings WHERE active = 1${source ? ' AND source = ?' : ''}`,
      source ? [source] : [],
    );
    let n = 0;
    for (let i = 0; i < rows.length; i += 300) {
      const stmts = rows.slice(i, i + 300).map((r) => {
        const pre = precompute({
          market: r.market as Listing['market'], price: Number(r.price), currency: r.currency, classic: !!r.classic,
          dutyRateOverride: r.duty_rate_override == null ? null : Number(r.duty_rate_override), originProof: !!r.origin_proof,
        });
        n++;
        // Referenzabstände mit dem neuen Endpreis nachziehen (ref_min_eur ist im SET noch der alte, unveränderte Wert)
        return {
          sql: `UPDATE listings SET price_eur = ?, landed_de = ?, landed_at = ?, landed_nl = ?, landed_pl = ?, ${DEST_CODES.map((d) => `ref_diff_${d.toLowerCase()} = ${refDiffSql('?')}`).join(', ')} WHERE id = ?`,
          args: [pre.priceEur, pre.landed.DE, pre.landed.AT, pre.landed.NL, pre.landed.PL, ...DEST_CODES.flatMap((d) => [pre.landed[d], pre.landed[d]]), r.id],
        };
      });
      await db().batch(stmts, 'write');
    }
    return n;
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

/** Übersetzungs-Cache für Encar-Ausstattungskombinationen */
export interface EncarGrade { manufacturer: string; model: string; badge: string; makeEn: string | null; modelEn: string | null; gradeEn: string | null; ccm: number | null }

export const encarGradesRepo = {
  async all(): Promise<Map<string, EncarGrade>> {
    const rows = await query<{ manufacturer: string; model: string; badge: string; make_en: string | null; model_en: string | null; grade_en: string | null; ccm: number | null }>('SELECT * FROM encar_grades');
    return new Map(rows.map((r) => [gradeKey(r.manufacturer, r.model, r.badge), { manufacturer: r.manufacturer, model: r.model, badge: r.badge, makeEn: r.make_en, modelEn: r.model_en, gradeEn: r.grade_en, ccm: r.ccm == null ? null : Number(r.ccm) }]));
  },
  async upsertMany(grades: EncarGrade[]): Promise<void> {
    if (!grades.length) return;
    const now = new Date().toISOString();
    for (let i = 0; i < grades.length; i += 200) {
      await db().batch(grades.slice(i, i + 200).map((g) => ({
        sql: 'INSERT INTO encar_grades(manufacturer, model, badge, make_en, model_en, grade_en, ccm, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(manufacturer, model, badge) DO UPDATE SET make_en = excluded.make_en, model_en = excluded.model_en, grade_en = excluded.grade_en, ccm = excluded.ccm, updated_at = excluded.updated_at',
        args: [g.manufacturer, g.model, g.badge, g.makeEn, g.modelEn, g.gradeEn, g.ccm, now],
      })), 'write');
    }
  },
};

export function gradeKey(manufacturer: string, model: string, badge: string): string {
  return `${manufacturer}${model}${badge}`;
}

export { run };
