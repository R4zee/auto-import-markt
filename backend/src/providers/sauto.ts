import { config } from '../config.js';
import type { Listing } from '../domain/types.js';
import { defaultPartnerFor } from '../seed/partners.js';
import { encarDrive } from './encar.js';
import { getJson, num, sleep, str } from './http.js';
import { listingId, normalizeFuel, normalizeTransmission, type MarketProvider, type ProviderResult } from './types.js';
import { makeFromTitle } from './olx.js';

/**
 * Sauto.cz (Tschechien, Seznam) – JSON-Endpunkt der Website, kein Key:
 *
 *   GET https://www.sauto.cz/api/v1/items/search?category_id=838&condition_seo=ojete,predvadeci&limit=200&offset=0&sort=1
 *   category_id 838 = Osobní (Pkw); Preisfenster price_from/price_to (Grenze 1.000 Treffer je Abfrage)
 *
 * Antwort { results: Item[], pagination{ total } }. Item (Erfahrungswerte, mit `npm run probe -- sauto` prüfen):
 * id, name ("Škoda Octavia 2.0 TDI"), price (CZK), manufacturer_cb{ name, seo_name }, model_cb{ name, seo_name },
 * tachometer (km), manufacturing_date ("2019-06-01…" oder Jahr), fuel_cb{ name }, gearbox_cb{ name }, engine_volume (ccm),
 * engine_power (kW), drive_cb{ name }, locality{ municipality | district | region }, images[{ url }] (protokollrelativ,
 * Größe per ?fl=…), premise{ name } (Händler), condition_cb{ name }, category{ seo_name }.
 * Detail-URL: https://www.sauto.cz/osobni/detail/<manufacturer seo>/<model seo>/<id>
 */
export interface SautoCb { id?: number; name?: string; seo_name?: string; value?: string | number }
export interface SautoItem {
  id: number | string; name?: string; price?: number | string; seo_name?: string;
  /** Ausstattungszeile, z. B. "1,2 TSi DSG *KLIMATIZACE*" (Live-Antwort 14.09.2026) */
  additional_model_name?: string; images_total_count?: number; deal_type?: string; price_by_agreement?: boolean;
  manufacturer_cb?: SautoCb; model_cb?: SautoCb; fuel_cb?: SautoCb; gearbox_cb?: SautoCb; drive_cb?: SautoCb; condition_cb?: SautoCb; category?: SautoCb;
  tachometer?: number | string; manufacturing_date?: string | number; in_operation_date?: string | number;
  engine_volume?: number | string; engine_power?: number | string;
  locality?: { municipality?: string; district?: string; region?: string; municipality_seo_name?: string; district_seo_name?: string };
  images?: Array<{ url?: string }>; premise?: { name?: string } | null; status?: { key?: string } | string;
}
export interface SautoResponse { results?: SautoItem[]; pagination?: { total?: number; limit?: number; offset?: number } }

export function sautoImage(url: string | undefined): string | null {
  if (!url) return null;
  const abs = url.startsWith('//') ? `https:${url}` : url;
  return abs.includes('?') ? abs : `${abs}?fl=exf|res,1024,768,1|jpg,85`;
}

export function sautoYear(v: string | number | undefined): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v > 1900 && v < 2100 ? v : null;
  const m = v.match(/(19|20)\d{2}/);
  return m ? Number(m[0]) : null;
}

export function mapSauto(it: SautoItem, fetchedAt: string): Listing | null {
  const externalId = str(it.id);
  const title = str(it.name).trim();
  const price = num(it.price);
  const year = sautoYear(it.manufacturing_date) ?? sautoYear(it.in_operation_date);
  if (!externalId || !title || !price || !year) return null;
  if (it.deal_type && it.deal_type !== 'sale') return null;
  const make = str(it.manufacturer_cb?.name ?? it.manufacturer_cb?.value) || makeFromTitle(title);
  const model = str(it.model_cb?.name ?? it.model_cb?.value) || title.replace(new RegExp(`^${make.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '').split(/\s+/)[0] || title;
  const fuelText = str(it.fuel_cb?.name);
  const fuel = /elektr/i.test(fuelText) && !/hybrid/i.test(fuelText) ? 'Electric' : /hybrid/i.test(fuelText) ? 'Hybrid' : /nafta|diesel/i.test(fuelText) ? 'Diesel' : normalizeFuel(fuelText);
  const gear = str(it.gearbox_cb?.name);
  const transmission = /manu/i.test(gear) ? 'Manual' : normalizeTransmission(gear || 'automat');
  const ccmRaw = num(it.engine_volume);
  const ccm = fuel === 'Electric' ? null : ccmRaw && ccmRaw > 400 && ccmRaw < 9000 ? Math.round(ccmRaw) : null;
  // Die Trefferliste liefert keinen Hubraum – Hubraumangabe aus der Ausstattungszeile ("1,2 TSi", "2.0 TDI")
  const extra = str(it.additional_model_name).trim();
  const litres = extra.match(/\b(\d)[,.](\d)\b/);
  const driveText = str(it.drive_cb?.name);
  const drive = /4x4|awd|všechna|vsechna|4wd/i.test(`${driveText} ${title}`) ? 'AWD' : /předn|predn/i.test(driveText) ? 'FWD' : /zadn/i.test(driveText) ? 'RWD' : encarDrive(title, make);
  const photos = (it.images ?? []).map((i) => sautoImage(i.url)).filter((p): p is string => !!p);
  const trim = extra || title.replace(new RegExp(`^${make.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '').replace(new RegExp(`^${model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '').replace(/^[,\s]+/, '').trim();
  const mSeo = str(it.manufacturer_cb?.seo_name) || make.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const moSeo = str(it.model_cb?.seo_name) || model.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  return {
    id: listingId('sauto', externalId),
    source: 'sauto',
    externalId,
    market: 'EE',
    country: 'cz',
    location: str(it.locality?.municipality) || str(it.locality?.district) || str(it.locality?.region),
    offerType: 'fixed',
    url: `https://www.sauto.cz/osobni/detail/${mSeo}/${moSeo}/${externalId}`,
    year,
    make,
    model,
    trim: trim.slice(0, 120),
    km: Math.round(num(it.tachometer) ?? 0),
    engine: fuel === 'Electric' ? 'EV' : ccm ? `${(ccm / 1000).toFixed(1)} L` : litres ? `${litres[1]}.${litres[2]} L` : '',
    engineCcm: ccm,
    co2Gkm: null,
    transmission,
    drive,
    fuel,
    price,
    currency: 'CZK',
    steering: 'LHD',
    auction: null,
    coc: true,
    classic: new Date().getFullYear() - year >= 30,
    dutyRateOverride: null,
    originProof: false,
    resaleEur: null,
    partnerId: defaultPartnerFor('EE'),
    photos,
    photoCount: Math.max(photos.length, num(it.images_total_count) ?? 0),
    damage: [],
    fetchedAt,
    active: true,
  };
}

export class SautoProvider implements MarketProvider {
  readonly id = 'sauto';
  readonly label = 'Sauto.cz (Tschechien, Frontend-Endpunkt)';

  enabled(): boolean {
    return config.sauto.enabled;
  }

  private http() {
    return { headers: { Accept: 'application/json', 'Accept-Language': 'cs', 'User-Agent': config.europe.userAgent, Referer: 'https://www.sauto.cz/' }, proxyUrl: config.europe.proxyUrl || undefined, timeoutMs: 30000 };
  }

  searchUrl(offset: number, priceFrom: number, priceTo: number | null): string {
    const p = new URLSearchParams({ category_id: String(config.sauto.categoryId), limit: String(config.sauto.pageSize), offset: String(offset), sort: '1' });
    p.set('condition_seo', 'ojete,predvadeci');
    p.set('operating_lease', 'false');
    p.set('price_from', String(priceFrom));
    if (priceTo != null) p.set('price_to', String(priceTo));
    if (config.sauto.minYear > 0) p.set('manufacturing_date_from', String(config.sauto.minYear));
    return `https://www.sauto.cz/api/v1/items/search?${p}`;
  }

  /** Preisfenster (CZK) unter der 1.000er-Grenze je Abfrage */
  priceBands(): Array<[number, number | null]> {
    const bands: Array<[number, number | null]> = [];
    let from = config.sauto.minPriceCzk;
    for (const step of [100_000, 100_000, 150_000, 150_000, 200_000, 300_000, 500_000, 1_000_000, 2_000_000]) {
      bands.push([from, from + step]);
      from += step;
    }
    bands.push([from, null]);
    return bands;
  }

  async fetchAll(): Promise<ProviderResult> {
    const fetchedAt = new Date().toISOString();
    const listings: Listing[] = [];
    const warnings: string[] = [];
    const seen = new Set<string>();
    let failed = 0;
    const bands = this.priceBands().slice(0, config.sauto.maxBands);
    for (const [from, to] of bands) {
      try {
        for (let page = 0; page < config.sauto.pages; page++) {
          const json = await getJson<SautoResponse>(this.searchUrl(page * config.sauto.pageSize, from, to), this.http());
          const items = json.results ?? [];
          if (!items.length) break;
          for (const it of items) {
            const l = mapSauto(it, fetchedAt);
            if (l && !seen.has(l.id)) { seen.add(l.id); listings.push(l); }
          }
          const total = num(json.pagination?.total);
          if (items.length < config.sauto.pageSize || (total != null && (page + 1) * config.sauto.pageSize >= total)) break;
          await sleep(config.sauto.delayMs);
        }
      } catch (e) {
        failed++;
        warnings.push(`${from}–${to ?? '∞'} CZK: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (failed === bands.length) throw new Error(`Sauto: alle Preisfenster fehlgeschlagen – ${warnings.slice(0, 2).join(' | ')}`);
    warnings.push(`${listings.length} Inserate aus ${bands.length - failed} Preisfenstern`);
    // vollständig nur, wenn alle Preisfenster und alle Seiten geladen wurden
    return { listings, complete: failed === 0 && config.sauto.pages >= 5, warnings };
  }
}
