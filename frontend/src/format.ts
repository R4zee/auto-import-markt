import type { Listing } from './api';

export type DisplayCurrency = 'EUR' | 'USD' | 'GBP' | 'CHF';

const SYMBOL: Record<string, string> = { JPY: '¥', KRW: '₩', USD: '$', AED: 'AED ', EUR: '€', GBP: '£', CHF: 'CHF ', PLN: 'zł ', CZK: 'Kč ', RON: 'lei ', BGN: 'лв ', HUF: 'Ft ' };

/** Anzeigekurse (Einheiten je EUR) aus EUR-je-Einheit-Kursen ableiten. */
export function displayRates(eurPerUnit: Record<string, number>): Record<DisplayCurrency, number> {
  const inv = (c: string, fb: number) => (eurPerUnit[c] ? 1 / eurPerUnit[c] : fb);
  return { EUR: 1, USD: inv('USD', 1.087), GBP: inv('GBP', 0.845), CHF: inv('CHF', 0.94) };
}

export function money(eur: number, ccy: DisplayCurrency, rates: Record<DisplayCurrency, number>): string {
  return SYMBOL[ccy] + (eur * rates[ccy]).toLocaleString('de-DE', { maximumFractionDigits: 0 });
}

export function local(l: Pick<Listing, 'price' | 'currency'>): string {
  return (SYMBOL[l.currency] ?? l.currency + ' ') + l.price.toLocaleString('de-DE', { maximumFractionDigits: 0 });
}

export function km(n: number): string {
  return n.toLocaleString('de-DE') + ' km';
}

export function countdown(endsAt: string, now: number, endedLabel: string): string {
  let s = Math.floor((new Date(endsAt).getTime() - now) / 1000);
  if (s <= 0) return endedLabel;
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return (d > 0 ? d + 'd ' : '') + p(h) + ':' + p(m) + ':' + p(s);
}

export function flag(code: string): string {
  return `https://flagcdn.com/w40/${code}.png`;
}

export function title(l: Pick<Listing, 'year' | 'make' | 'model'>): string {
  return `${l.year} ${l.make} ${l.model}`;
}
