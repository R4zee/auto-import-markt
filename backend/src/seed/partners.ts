import type { Partner } from '../domain/types.js';

/** Partner-Importeure aus dem Design. E-Mails sind Platzhalter bis Verträge stehen. */
export const SEED_PARTNERS: Partner[] = [
  // Japan und Südkorea wickelt ein Partner ab (vormals Kaido Trading / Hanbit Motors; Bestand per Migration umgehängt)
  { id: 'fareast', name: 'Far East Imports', note: 'Japan & Korea → Bremerhaven', markets: ['JP', 'KR'], email: null },
  { id: 'atlantic', name: 'Atlantic Vehicle Logistics', note: 'Newark → Bremerhaven, 15 yrs', markets: ['US'], email: null },
  { id: 'gulfbridge', name: 'Gulf Bridge Motors', note: 'Jebel Ali → Bremerhaven, 6 yrs', markets: ['GCC'], email: null },
  { id: 'adriatica', name: 'Adriatica Auto Export', note: 'Milan → door delivery, 9 yrs', markets: ['SE'], email: null },
  { id: 'carpathia', name: 'Carpathia Fahrzeughandel', note: 'Bucharest → door delivery, 7 yrs', markets: ['EE'], email: null },
];

/** Ordnet einen Markt dem Standard-Partner zu (für externe Provider ohne eigene Partnerinfo). */
export function defaultPartnerFor(market: Partner['markets'][number]): string {
  return SEED_PARTNERS.find((p) => p.markets.includes(market))?.id ?? 'fareast';
}
