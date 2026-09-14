import { config } from '../config.js';
import { ApibaraProvider } from './apibara.js';
import { AutoApiProvider } from './autoapi.js';
import { EbayMotorsProvider } from './ebay.js';
import { EncarProvider } from './encar.js';
import { feedProviders } from './feed.js';
import { MarketCheckProvider } from './marketcheck.js';
import { MockProvider } from './mock.js';
import { OlxProvider } from './olx.js';
import { SautoProvider } from './sauto.js';
import { SubitoProvider } from './subito.js';
import type { MarketProvider } from './types.js';
import { XapiKoreaProvider } from './xapikorea.js';

const ALL: MarketProvider[] = [
  new MockProvider(),
  new EncarProvider(),
  new XapiKoreaProvider(),
  new MarketCheckProvider(),
  new EbayMotorsProvider(),
  new ApibaraProvider(),
  new AutoApiProvider(),
  // Süd-/Osteuropa: keyless Frontend-Endpunkte (Grauzone wie Encar, je Seite schaltbar)
  new OlxProvider(),
  new SubitoProvider(),
  new SautoProvider(),
  ...feedProviders(),
];

export function activeProviders(): MarketProvider[] {
  return ALL.filter((p) => (p.id === 'mock' ? config.enableMockProvider : p.enabled()));
}

export function allProviders(): MarketProvider[] {
  return ALL;
}

/**
 * Gehört ein Quellen-Schlüssel zu einem bekannten Provider? (auto-api nutzt Präfixe wie "autoapi-dubizzle").
 * Partner-Feeds gelten als bekannt, solange sie konfiguriert sind – ein entfernter Feed wird beim nächsten
 * Sync-Lauf als verwaiste Quelle deaktiviert.
 */
export function isKnownSource(source: string): boolean {
  return ALL.some((p) => source === p.id || source.startsWith(`${p.id}-`));
}
