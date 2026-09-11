import { config } from '../config.ts';
import type { Listing } from '../domain/types.ts';
import { defaultPartnerFor } from '../seed/partners.ts';
import { listingId, milesToKm, normalizeDrive, normalizeFuel, normalizeTransmission, type MarketProvider, type ProviderResult } from './types.ts';

/**
 * MarketCheck – US-Händlerbestand (Festpreis). Self-Service-Key unter
 * https://www.marketcheck.com/apis (Free: 500 Calls/Monat).
 * Feldnamen entsprechen der v2-Dokumentation (docs.marketcheck.com) und sind
 * beim ersten Live-Lauf gegen die echte Antwort zu prüfen.
 */
interface McListing {
  id: string;
  vin?: string;
  heading?: string;
  price?: number;
  miles?: number;
  vdp_url?: string;
  build?: {
    year?: number; make?: string; model?: string; trim?: string; body_type?: string;
    fuel_type?: string; transmission?: string; drivetrain?: string; engine_size?: number; engine?: string;
  };
  dealer?: { city?: string; state?: string };
  media?: { photo_links?: string[] };
}

export class MarketCheckProvider implements MarketProvider {
  readonly id = 'marketcheck';
  readonly label = 'MarketCheck (USA)';

  enabled(): boolean {
    return config.marketcheck.apiKey.length > 0;
  }

  async fetchAll(): Promise<ProviderResult> {
    const listings: Listing[] = [];
    for (const make of config.marketcheck.makes) {
      const params = new URLSearchParams({
        api_key: config.marketcheck.apiKey,
        make,
        car_type: 'used',
        rows: '50',
        start: '0',
        include_relevant_links: 'false',
      });
      const res = await fetch(`https://api.marketcheck.com/v2/search/car/active?${params}`, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`MarketCheck HTTP ${res.status} (${make})`);
      const json = (await res.json()) as { listings?: McListing[] };
      for (const l of json.listings ?? []) {
        const mapped = this.map(l);
        if (mapped) listings.push(mapped);
      }
    }
    return { listings, complete: true };
  }

  private map(l: McListing): Listing | null {
    const b = l.build ?? {};
    if (!b.year || !b.make || !b.model || !l.price) return null;
    const engineL = b.engine_size ? `${b.engine_size.toFixed(1)}` : '';
    const engine = b.engine ?? (engineL ? `${engineL} ${b.body_type ?? ''}`.trim() : '');
    return {
      id: listingId(this.id, l.id),
      source: this.id,
      externalId: l.id,
      market: 'US',
      country: 'us',
      location: [l.dealer?.city, l.dealer?.state].filter(Boolean).join(', '),
      offerType: 'fixed',
      url: l.vdp_url ?? null,
      year: b.year,
      make: b.make,
      model: b.model,
      trim: b.trim ?? '',
      km: milesToKm(l.miles ?? 0),
      engine,
      engineCcm: b.engine_size ? Math.round(b.engine_size * 1000) : null,
      co2Gkm: null,
      transmission: normalizeTransmission(b.transmission),
      drive: normalizeDrive(b.drivetrain),
      fuel: normalizeFuel(b.fuel_type),
      price: l.price,
      currency: 'USD',
      steering: 'LHD',
      auction: null,
      coc: false,
      classic: new Date().getFullYear() - b.year >= 30,
      dutyRateOverride: null,
      originProof: false,
      resaleEur: null,
      partnerId: defaultPartnerFor('US'),
      photos: l.media?.photo_links ?? [],
      photoCount: l.media?.photo_links?.length ?? 0,
      damage: [],
      fetchedAt: new Date().toISOString(),
      active: true,
    };
  }
}
