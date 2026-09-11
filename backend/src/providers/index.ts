import { config } from '../config.ts';
import { ApibaraProvider } from './apibara.ts';
import { AutoApiProvider } from './autoapi.ts';
import { CarapisProvider } from './carapis.ts';
import { EbayMotorsProvider } from './ebay.ts';
import { EncarProvider } from './encar.ts';
import { JsonFeedProvider } from './feed.ts';
import { MarketCheckProvider } from './marketcheck.ts';
import { MockProvider } from './mock.ts';
import type { MarketProvider } from './types.ts';

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
