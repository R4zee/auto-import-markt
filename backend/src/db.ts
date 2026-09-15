import { createClient, type Client, type InValue } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

let client: Client | null = null;
let migration: Promise<void> | null = null;

export type Row = Record<string, InValue>;

function create(): Client {
  const url = config.database.url;
  if (url.startsWith('file:')) mkdirSync(dirname(url.slice('file:'.length)), { recursive: true });
  return createClient({ url, authToken: config.database.authToken });
}

/** Roher Client (nur nach `ready()` verwenden). */
export function db(): Client {
  if (!client) client = create();
  return client;
}

/** Stellt sicher, dass Schema und Verbindung bereitstehen. */
export async function ready(): Promise<Client> {
  if (!migration) migration = migrate().catch((e) => { migration = null; throw e; });
  await migration;
  return db();
}

export async function closeDb(): Promise<void> {
  client?.close();
  client = null;
  migration = null;
}

export async function query<T extends Row = Row>(sql: string, args: InValue[] = []): Promise<T[]> {
  const res = await db().execute({ sql, args });
  return res.rows as unknown as T[];
}

export async function one<T extends Row = Row>(sql: string, args: InValue[] = []): Promise<T | null> {
  const rows = await query<T>(sql, args);
  return rows[0] ?? null;
}

export async function run(sql: string, args: InValue[] = []): Promise<{ rowsAffected: number; lastInsertRowid: bigint | undefined }> {
  const res = await db().execute({ sql, args });
  return { rowsAffected: res.rowsAffected, lastInsertRowid: res.lastInsertRowid };
}

/** Spalte nachrüsten, falls sie fehlt (SQLite kennt kein ADD COLUMN IF NOT EXISTS). */
async function ensureColumn(c: Client, table: string, column: string, ddl: string): Promise<void> {
  const cols = (await c.execute(`PRAGMA table_info(${table})`)).rows as unknown as Array<{ name: string }>;
  if (!cols.some((r) => r.name === column)) await c.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

async function migrate(): Promise<void> {
  const c = db();
  if (config.database.url.startsWith('file:')) {
    await c.execute('PRAGMA journal_mode = WAL');
  }
  await c.executeMultiple(`
    CREATE TABLE IF NOT EXISTS partners (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      markets TEXT NOT NULL DEFAULT '[]',
      email TEXT
    );

    CREATE TABLE IF NOT EXISTS listings (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      external_id TEXT NOT NULL,
      market TEXT NOT NULL,
      country TEXT NOT NULL,
      location TEXT NOT NULL DEFAULT '',
      offer_type TEXT NOT NULL,
      url TEXT,
      year INTEGER NOT NULL,
      make TEXT NOT NULL,
      model TEXT NOT NULL,
      trim TEXT NOT NULL DEFAULT '',
      km INTEGER NOT NULL,
      engine TEXT NOT NULL DEFAULT '',
      engine_ccm INTEGER,
      co2_gkm INTEGER,
      transmission TEXT NOT NULL,
      drive TEXT NOT NULL,
      fuel TEXT NOT NULL,
      price REAL NOT NULL,
      currency TEXT NOT NULL,
      steering TEXT NOT NULL DEFAULT 'LHD',
      auction_json TEXT,
      coc INTEGER NOT NULL DEFAULT 0,
      classic INTEGER NOT NULL DEFAULT 0,
      duty_rate_override REAL,
      origin_proof INTEGER NOT NULL DEFAULT 0,
      resale_eur REAL,
      partner_id TEXT NOT NULL,
      photos_json TEXT NOT NULL DEFAULT '[]',
      photo_count INTEGER NOT NULL DEFAULT 0,
      damage_json TEXT NOT NULL DEFAULT '[]',
      fetched_at TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_listings_market ON listings(market, active);
    CREATE INDEX IF NOT EXISTS idx_listings_make ON listings(make, model);
    CREATE INDEX IF NOT EXISTS idx_listings_source ON listings(source);

    CREATE TABLE IF NOT EXISTS sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      upserted INTEGER NOT NULL DEFAULT 0,
      deactivated INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS fx_rates (
      currency TEXT PRIMARY KEY,
      eur_per_unit REAL NOT NULL,
      as_of TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS enquiries (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      kind TEXT NOT NULL,
      listing_ids TEXT NOT NULL,
      partner_id TEXT,
      dest TEXT NOT NULL,
      lang TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      message TEXT NOT NULL,
      opt_inspection INTEGER NOT NULL DEFAULT 0,
      opt_bid INTEGER NOT NULL DEFAULT 0,
      landed_json TEXT,
      status TEXT NOT NULL DEFAULT 'new'
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Vergleichspreise DE: je Suchbucket (Quelle, Marke, Variante, Kraftstoff, Baujahrband) die günstigsten Angebote
    -- mit Preis/Baujahr/km/Leistung als JSON; das Laufleistungsfenster wird je Inserat beim Ausliefern angewendet
    CREATE TABLE IF NOT EXISTS ref_prices (
      key TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      query_json TEXT NOT NULL,
      samples_json TEXT NOT NULL,
      total INTEGER,
      url TEXT NOT NULL DEFAULT '',
      fetched_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ref_prices_fetched ON ref_prices(fetched_at);

    -- Übersetzungs-/Spezifikations-Cache je Encar-Ausstattungskombination (Hersteller, Modell, Badge → englische Namen, Hubraum)
    CREATE TABLE IF NOT EXISTS encar_grades (
      manufacturer TEXT NOT NULL,
      model TEXT NOT NULL,
      badge TEXT NOT NULL,
      make_en TEXT,
      model_en TEXT,
      grade_en TEXT,
      ccm INTEGER,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (manufacturer, model, badge)
    );
  `);

  // Vorberechnete Werte für SQL-Filter/-Sortierung bei großen Beständen
  await ensureColumn(c, 'listings', 'price_eur', 'REAL');
  await ensureColumn(c, 'listings', 'landed_de', 'REAL');
  await ensureColumn(c, 'listings', 'landed_at', 'REAL');
  await ensureColumn(c, 'listings', 'landed_nl', 'REAL');
  await ensureColumn(c, 'listings', 'landed_pl', 'REAL');
  await ensureColumn(c, 'listings', 'auction_ends_at', 'TEXT');
  // Volltext-Hilfsspalte (klein geschrieben: Marke Modell Ausstattung Standort Losnummer) – wird beim Upsert gesetzt
  await ensureColumn(c, 'listings', 'search_text', 'TEXT');
  // Einmaliges Nachfüllen für Bestände von vor dieser Spalte – mit Merker in `meta`, damit nicht jeder Kaltstart
  // die Tabelle nach NULL-Werten durchsucht (auf Turso zählt jede gelesene Zeile)
  const backfilled = await c.execute("SELECT value FROM meta WHERE key = 'search_text_backfilled'");
  if (!backfilled.rows.length) {
    await c.execute(`UPDATE listings SET search_text = ${SEARCH_TEXT_SQL} WHERE search_text IS NULL`);
    await c.execute("INSERT INTO meta(key, value) VALUES ('search_text_backfilled', '1') ON CONFLICT(key) DO NOTHING");
  }
  await c.executeMultiple(`
    -- Sortier-Indizes: geordneter Lauf mit frühem Abbruch (LIMIT), die Bereichsfilter selbst nutzen sie nicht (siehe repositories/listings.ts)
    CREATE INDEX IF NOT EXISTS idx_listings_active_landed_de ON listings(active, landed_de);
    CREATE INDEX IF NOT EXISTS idx_listings_active_year ON listings(active, year);
    CREATE INDEX IF NOT EXISTS idx_listings_active_km ON listings(active, km);
    CREATE INDEX IF NOT EXISTS idx_listings_active_make ON listings(active, make, model);
    -- Abdeckender Suchindex: Zählen, Filtern und Sortieren laufen komplett im Index, Zeilen werden nur für die
    -- ausgelieferte Seite gelesen (150.000 Inserate: Zählung je Marke < 5 ms statt Vollscan über alle Zeilen).
    -- Bei geänderter Spaltenliste den Namen hochzählen (IF NOT EXISTS ersetzt keine bestehende Definition).
    CREATE INDEX IF NOT EXISTS idx_listings_search_v1 ON listings(
      active, make, model, year, km, landed_de, landed_at, landed_nl, landed_pl, price_eur,
      market, offer_type, fuel, transmission, coc, location, auction_ends_at, search_text
    );
  `);
}

/**
 * SQL-Ausdruck für die Suchspalte (identisch zum Wert, den der Upsert setzt).
 * `makeExpr` erlaubt einen Platzhalter statt der Spalte, wenn die Marke im selben UPDATE neu gesetzt wird
 * (SQLite wertet SET-Ausdrücke mit den alten Spaltenwerten aus).
 */
export function searchTextSql(makeExpr = 'make'): string {
  return `LOWER(${makeExpr} || ' ' || model || ' ' || trim || ' ' || location || ' ' || COALESCE(json_extract(auction_json, '$.lot'), '') || ' ' || COALESCE(json_extract(auction_json, '$.house'), ''))`;
}
export const SEARCH_TEXT_SQL = searchTextSql();
