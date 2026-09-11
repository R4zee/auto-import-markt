import type { Partner } from '../domain/types.js';

/** Partner-Importeure aus dem Design. E-Mails sind Platzhalter bis Verträge stehen. */
export const SEED_PARTNERS: Partner[] = [
  { id: 'kaido', name: 'Kaido Trading GmbH', note: 'Nagoya → Bremerhaven, 12 yrs', markets: ['JP'], email: null },
  { id: 'hanbit', name: 'Hanbit Motors Export', note: 'Incheon → Bremerhaven, 8 yrs', markets: ['KR'], email: null },
  { id: 'atlantic', name: 'Atlantic Vehicle Logistics', note: 'Newark → Bremerhaven, 15 yrs', markets: ['US'], email: null },
  { id: 'gulfbridge', name: 'Gulf Bridge Motors', note: 'Jebel Ali → Bremerhaven, 6 yrs', markets: ['GCC'], email: null },
  { id: 'adriatica', name: 'Adriatica Auto Export', note: 'Milan → door delivery, 9 yrs', markets: ['SE'], email: null },
  { id: 'carpathia', name: 'Carpathia Fahrzeughandel', note: 'Bucharest → door delivery, 7 yrs', markets: ['EE'], email: null },
];

/** Ordnet einen Markt dem Standard-Partner zu (für externe Provider ohne eigene Partnerinfo). */
export function defaultPartnerFor(market: Partner['markets'][number]): string {
  return SEED_PARTNERS.find((p) => p.markets.includes(market))?.id ?? 'kaido';
}
