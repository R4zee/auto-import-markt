import { config } from '../config.ts';
import { db, query } from '../db.ts';

/** EUR je Einheit Fremdwährung. Fallback = Designwerte, falls die EZB-Abfrage scheitert. */
const FALLBACK: Record<string, number> = {
  EUR: 1,
  JPY: 0.0061,
  KRW: 0.00069,
  USD: 0.92,
  AED: 0.25,
  GBP: 1 / 0.845,
  CHF: 1 / 0.94,
};

const TRACKED = ['JPY', 'KRW', 'USD', 'AED', 'GBP', 'CHF'];
const TTL_MS = 6 * 60 * 60 * 1000;

interface FxState {
  rates: Record<string, number>;
  asOf: string;
  source: 'ecb' | 'db' | 'fallback';
  loadedAt: number;
}

let state: FxState | null = null;

async function loadFromDb(): Promise<FxState | null> {
  const rows = await query<{ currency: string; eur_per_unit: number; as_of: string }>('SELECT currency, eur_per_unit, as_of FROM fx_rates');
  if (!rows.length) return null;
  const rates: Record<string, number> = { EUR: 1 };
  let asOf = '';
  for (const r of rows) { rates[r.currency] = Number(r.eur_per_unit); asOf = r.as_of; }
  return { rates: { ...FALLBACK, ...rates }, asOf, source: 'db', loadedAt: Date.now() };
}

async function saveToDb(rates: Record<string, number>, asOf: string): Promise<void> {
  await db().batch(
    Object.entries(rates)
      .filter(([ccy]) => ccy !== 'EUR')
      .map(([ccy, v]) => ({
        sql: 'INSERT INTO fx_rates(currency, eur_per_unit, as_of) VALUES (?, ?, ?) ON CONFLICT(currency) DO UPDATE SET eur_per_unit = excluded.eur_per_unit, as_of = excluded.as_of',
        args: [ccy, v, asOf],
      })),
    'write',
  );
}

async function fetchEcb(): Promise<FxState> {
  const url = `${config.fxBaseUrl}/latest?base=EUR&symbols=${TRACKED.join(',')}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`FX HTTP ${res.status}`);
  const json = (await res.json()) as { date: string; rates: Record<string, number> };
  const rates: Record<string, number> = { EUR: 1 };
  for (const [ccy, perEur] of Object.entries(json.rates)) rates[ccy] = 1 / perEur;
  // AED ist nicht im EZB-Set: fester USD-Peg 3.6725
  if (!rates.AED && rates.USD) rates.AED = rates.USD / 3.6725;
  try { await saveToDb(rates, json.date); } catch { /* Kurse nur im Speicher */ }
  return { rates: { ...FALLBACK, ...rates }, asOf: json.date, source: 'ecb', loadedAt: Date.now() };
}

export async function getFx(): Promise<FxState> {
  if (state && Date.now() - state.loadedAt < TTL_MS) return state;
  try {
    state = await fetchEcb();
  } catch {
    let fromDb: FxState | null = null;
    try { fromDb = await loadFromDb(); } catch { /* ignore */ }
    state = fromDb ?? { rates: { ...FALLBACK }, asOf: 'fallback', source: 'fallback', loadedAt: Date.now() };
  }
  return state;
}

/** Synchroner Zugriff auf den zuletzt geladenen Stand (nach getFx()). */
export function fxSync(): FxState {
  return state ?? { rates: { ...FALLBACK }, asOf: 'fallback', source: 'fallback', loadedAt: 0 };
}

export function eurRate(currency: string): number {
  const r = fxSync().rates[currency.toUpperCase()];
  if (r == null) throw new Error(`Unbekannte Währung: ${currency}`);
  return r;
}
