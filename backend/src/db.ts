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
  await c.executeMultiple(`
    CREATE INDEX IF NOT EXISTS idx_listings_active_landed_de ON listings(active, landed_de);
    CREATE INDEX IF NOT EXISTS idx_listings_active_year ON listings(active, year);
    CREATE INDEX IF NOT EXISTS idx_listings_active_km ON listings(active, km);
    CREATE INDEX IF NOT EXISTS idx_listings_active_make ON listings(active, make, model);
  `);
}
