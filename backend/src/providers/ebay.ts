import { config } from '../config.ts';
import type { Listing } from '../domain/types.ts';
import { defaultPartnerFor } from '../seed/partners.ts';
import { listingId, milesToKm, normalizeDrive, normalizeFuel, normalizeTransmission, type MarketProvider, type ProviderResult } from './types.ts';

/**
 * eBay Motors über die Browse API (Kategorie 6001 "Cars & Trucks").
 * OAuth2 Client-Credentials, Scope https://api.ebay.com/oauth/api_scope.
 * Auktionen werden als offerType 'auction' mit Endzeitpunkt übernommen.
 */
interface EbayItem {
  itemId: string;
  title: string;
  price?: { value: string; currency: string };
  currentBidPrice?: { value: string; currency: string };
  buyingOptions?: string[];
  itemEndDate?: string;
  itemWebUrl?: string;
  image?: { imageUrl: string };
  additionalImages?: Array<{ imageUrl: string }>;
  itemLocation?: { city?: string; stateOrProvince?: string; country?: string };
  localizedAspects?: Array<{ name: string; value: string }>;
}

export class EbayMotorsProvider implements MarketProvider {
  readonly id = 'ebay';
  readonly label = 'eBay Motors (USA)';
  private token: { value: string; expiresAt: number } | null = null;

  enabled(): boolean {
    return config.ebay.clientId.length > 0 && config.ebay.clientSecret.length > 0;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const basic = Buffer.from(`${config.ebay.clientId}:${config.ebay.clientSecret}`).toString('base64');
    const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`eBay OAuth HTTP ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return this.token.value;
  }

  async fetchAll(): Promise<ProviderResult> {
    const token = await this.accessToken();
    const params = new URLSearchParams({
      category_ids: '6001',
      limit: '200',
      filter: 'buyingOptions:{AUCTION|FIXED_PRICE},itemLocationCountry:US,price:[5000..],priceCurrency:USD',
      sort: 'newlyListed',
    });
    const res = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': config.ebay.marketplaceId },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`eBay Browse HTTP ${res.status}`);
    const json = (await res.json()) as { itemSummaries?: EbayItem[] };
    const listings = (json.itemSummaries ?? []).map((i) => this.map(i)).filter((l): l is Listing => l !== null);
    // Ein Suchlauf deckt nicht den gesamten Bestand ab → alte Listings nicht deaktivieren
    return { listings, complete: false };
  }

  private aspect(item: EbayItem, name: string): string | undefined {
    return item.localizedAspects?.find((a) => a.name.toLowerCase() === name.toLowerCase())?.value;
  }

  private map(i: EbayItem): Listing | null {
    const year = Number(this.aspect(i, 'Year'));
    const make = this.aspect(i, 'Make');
    const model = this.aspect(i, 'Model');
    const priceStr = i.currentBidPrice?.value ?? i.price?.value;
    if (!year || !make || !model || !priceStr) return null;
    const isAuction = (i.buyingOptions ?? []).includes('AUCTION') && !!i.itemEndDate;
    const miles = Number((this.aspect(i, 'Mileage') ?? '0').replace(/[^\d]/g, ''));
    const photos = [i.image?.imageUrl, ...(i.additionalImages ?? []).map((a) => a.imageUrl)].filter((u): u is string => !!u);
    const steering = (this.aspect(i, 'Steering') ?? 'left').toLowerCase().includes('right') ? 'RHD' : 'LHD';
    return {
      id: listingId(this.id, i.itemId),
      source: this.id,
      externalId: i.itemId,
      market: 'US',
      country: 'us',
      location: [i.itemLocation?.city, i.itemLocation?.stateOrProvince].filter(Boolean).join(', '),
      offerType: isAuction ? 'auction' : 'fixed',
      url: i.itemWebUrl ?? null,
      year,
      make,
      model,
      trim: this.aspect(i, 'Trim') ?? '',
      km: milesToKm(miles),
      engine: this.aspect(i, 'Engine') ?? '',
      engineCcm: null,
      co2Gkm: null,
      transmission: normalizeTransmission(this.aspect(i, 'Transmission')),
      drive: normalizeDrive(this.aspect(i, 'Drive Type')),
      fuel: normalizeFuel(this.aspect(i, 'Fuel Type')),
      price: Number(priceStr),
      currency: i.price?.currency ?? 'USD',
      steering,
      auction: isAuction
        ? { house: 'eBay Motors', lot: i.itemId, grade: null, gradeNote: null, hammerLow: null, hammerHigh: null, endsAt: i.itemEndDate! }
        : null,
      coc: false,
      classic: new Date().getFullYear() - year >= 30,
      dutyRateOverride: null,
      originProof: false,
      resaleEur: null,
      partnerId: defaultPartnerFor('US'),
      photos,
      photoCount: photos.length,
      damage: [],
      fetchedAt: new Date().toISOString(),
      active: true,
    };
  }
}
