import { config } from '../config.js';
import { ApibaraProvider } from './apibara.js';
import { AutoApiProvider } from './autoapi.js';
import { CarapisProvider } from './carapis.js';
import { EbayMotorsProvider } from './ebay.js';
import { EncarProvider } from './encar.js';
import { JsonFeedProvider } from './feed.js';
import { MarketCheckProvider } from './marketcheck.js';
import { MockProvider } from './mock.js';
import type { MarketProvider } from './types.js';

const ALL: MarketProvider[] = [
  new MockProvider(),
  new MarketCheckProvider(),
  new EbayMotorsProvider(),
  new ApibaraProvider(),
  new EncarProvider(),
  new AutoApiProvider(),
  new CarapisProvider(),
  new JsonFeedProvider(),
];

export function activeProviders(): MarketProvider[] {
  return ALL.filter((p) => (p.id === 'mock' ? config.enableMockProvider : p.enabled()));
}

export function allProviders(): MarketProvider[] {
  return ALL;
}
