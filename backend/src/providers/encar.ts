import { config } from '../config.js';
import type { Listing } from '../domain/types.js';
import { defaultPartnerFor } from '../seed/partners.js';
import { getJson, HttpError, num, sleep, str } from './http.js';
import { listingId, type MarketProvider, type ProviderResult } from './types.js';

/**
 * Encar (Südkorea) – größter Gebrauchtwagenmarktplatz, direkt angebunden.
 * Kein offizielles API; die Frontend-Endpunkte sind öffentlich und ohne Key erreichbar (Stand 09/2026):
 *   Liste:  GET https://api.encar.com/search/car/list/premium?count=true&q=<Filter>&sr=|ModifiedDate|<offset>|<limit>
 *           Filter: (And.Hidden.N._.SellType.일반._.CarType.Y._.Manufacturer.현대._.Price.range(1000..).)
 *   Detail: GET https://api.encar.com/v1/readside/vehicle/{id}?include=CATEGORY,SPEC,ADVERTISEMENT
 * Preise stehen in 만원 (×10.000 KRW), Fotos unter https://ci.encar.com + Pfad.
 * Undokumentierter Endpunkt → nur mit ENCAR_ENABLED=true aktiv, gedrosselt, Rechtsgrundlage prüfen.
 */

export interface EncarListItem {
  Id: string; Manufacturer: string; Model: string; Badge?: string; BadgeDetail?: string;
  FormYear?: string; Year?: number; Mileage?: number; Price?: number; FuelType?: string; Transmission?: string;
  OfficeCityState?: string; OfficeName?: string; SellType?: string; Lease?: string;
  Photos?: Array<{ location: string; ordering?: number }>;
}

export interface EncarDetail {
  vehicleId: number;
  category?: {
    manufacturerName?: string; manufacturerEnglishName?: string; modelGroupName?: string; modelGroupEnglishName?: string;
    modelName?: string; gradeName?: string; gradeEnglishName?: string; gradeDetailName?: string | null; yearMonth?: string; formYear?: string; domestic?: boolean;
  };
  spec?: { mileage?: number; displacement?: number; transmissionName?: string; fuelName?: string; bodyName?: string; colorName?: string };
  advertisement?: { price?: number };
  contact?: { address?: string };
}

const CITY_EN: Record<string, string> = {
  '서울': 'Seoul', '부산': 'Busan', '대구': 'Daegu', '인천': 'Incheon', '광주': 'Gwangju', '대전': 'Daejeon', '울산': 'Ulsan', '세종': 'Sejong',
  '경기': 'Gyeonggi', '강원': 'Gangwon', '충북': 'Chungbuk', '충남': 'Chungnam', '전북': 'Jeonbuk', '전남': 'Jeonnam', '경북': 'Gyeongbuk',
  '경남': 'Gyeongnam', '제주': 'Jeju',
};

const MAKER_EN: Record<string, string> = {
  '현대': 'Hyundai', '기아': 'Kia', '제네시스': 'Genesis', '쉐보레(GM대우)': 'Chevrolet', '쉐보레': 'Chevrolet',
  '르노코리아(삼성)': 'Renault Korea', '르노삼성': 'Renault Korea', 'KG모빌리티(쌍용)': 'KG Mobility', '쌍용': 'SsangYong',
  '벤츠': 'Mercedes-Benz', '아우디': 'Audi', '폭스바겐': 'Volkswagen', '볼보': 'Volvo', '렉서스': 'Lexus', '토요타': 'Toyota',
  '포르쉐': 'Porsche', '랜드로버': 'Land Rover', '미니': 'Mini', '테슬라': 'Tesla', '혼다': 'Honda', '닛산': 'Nissan',
  '포드': 'Ford', '지프': 'Jeep', '링컨': 'Lincoln', '캐딜락': 'Cadillac', '마세라티': 'Maserati', '재규어': 'Jaguar',
  '푸조': 'Peugeot', '시트로엥': 'Citroën', '페라리': 'Ferrari', '람보르기니': 'Lamborghini', '벤틀리': 'Bentley',
  '롤스로이스': 'Rolls-Royce', '인피니티': 'Infiniti', '크라이슬러': 'Chrysler', '닷지': 'Dodge', '피아트': 'Fiat',
};

const HANGUL = /[ㄱ-ㆎ가-힣]/;

export function encarFuel(v: string | undefined): Listing['fuel'] {
  const s = v ?? '';
  if (s.includes('전기') && !s.includes('+')) return 'Electric';
  if (s.includes('수소')) return 'Electric';
  if (s.includes('하이브리드') || s.includes('+')) return 'Hybrid';
  if (s.includes('디젤')) return 'Diesel';
  return 'Petrol'; // 가솔린, LPG
}

export function encarTransmission(v: string | undefined): Listing['transmission'] {
  const s = v ?? '';
  if (s.includes('수동')) return 'Manual';
  return 'Automatic'; // 오토, 세미오토, CVT
}

export function encarDrive(badge: string, make: string): Listing['drive'] {
  const b = badge.toUpperCase();
  if (/4WD|AWD|HTRAC|XDRIVE|4MATIC|QUATTRO|4X4|SH-AWD|E-FOUR/.test(b)) return 'AWD';
  if (/GENESIS|BMW|MERCEDES|PORSCHE|LEXUS|JAGUAR|MASERATI/i.test(make)) return 'RWD';
  return 'FWD';
}

/** Ausstattungszeile nur aus englischen Bestandteilen; koreanische Reste bleiben außen vor. */
export function encarTrim(item: EncarListItem, detail: EncarDetail | null): string {
  const cat = detail?.category;
  const parts = [cat?.gradeEnglishName, cat?.gradeDetailName ?? undefined, item.Badge, item.BadgeDetail]
    .map((p) => (p ?? '').trim())
    .filter((p) => p && !HANGUL.test(p) && !p.includes('세부등급'));
  return Array.from(new Set(parts)).join(' · ');
}

export function mapEncar(item: EncarListItem, detail: EncarDetail | null, fetchedAt: string): Listing | null {
  const priceManwon = num(item.Price);
  const year = num(item.FormYear) ?? (item.Year ? Math.floor(item.Year / 100) : null);
  if (!priceManwon || priceManwon < 50 || !year || item.Lease === '1') return null;
  const cat = detail?.category;
  const make = cat?.manufacturerEnglishName || MAKER_EN[item.Manufacturer] || item.Manufacturer;
  const model = cat?.modelGroupEnglishName || item.Model;
  const grade = cat?.gradeEnglishName || item.Badge || '';
  const fuel = encarFuel(detail?.spec?.fuelName ?? item.FuelType);
  // Bei Elektrofahrzeugen steht in displacement kein Hubraum (z. B. Batteriewert)
  const ccm = fuel === 'Electric' ? null : detail?.spec?.displacement ?? null;
  const photos = (item.Photos ?? [])
    .slice()
    .sort((a, b) => (a.ordering ?? 0) - (b.ordering ?? 0))
    .map((p) => `https://ci.encar.com${p.location}`);
  const engine = fuel === 'Electric' ? 'EV' : ccm ? `${(ccm / 1000).toFixed(1)} L` : grade.match(/\d\.\d/)?.[0] ?? '';

  return {
    id: listingId('encar', item.Id),
    source: 'encar',
    externalId: item.Id,
    market: 'KR',
    country: 'kr',
    location: CITY_EN[str(item.OfficeCityState)] ?? str(item.OfficeCityState),
    offerType: 'fixed',
    url: `https://fem.encar.com/cars/detail/${item.Id}`,
    year,
    make,
    model,
    trim: encarTrim(item, detail),
    km: Math.round(num(item.Mileage) ?? detail?.spec?.mileage ?? 0),
    engine,
    engineCcm: ccm,
    co2Gkm: null,
    transmission: encarTransmission(detail?.spec?.transmissionName ?? item.Transmission),
    drive: encarDrive(`${grade} ${item.Badge ?? ''}`, make),
    fuel,
    price: priceManwon * 10000,
    currency: 'KRW',
    steering: 'LHD',
    auction: null,
    coc: false,
    classic: new Date().getFullYear() - year >= 30,
    dutyRateOverride: null,
    originProof: false,
    resaleEur: null,
    partnerId: defaultPartnerFor('KR'),
    photos,
    photoCount: photos.length,
    damage: [],
    fetchedAt,
    active: true,
  };
}

export class EncarProvider implements MarketProvider {
  readonly id = 'encar';
  readonly label = 'Encar (Südkorea, direkt)';

  enabled(): boolean {
    return config.encar.enabled;
  }

  buildQuery(manufacturer: string | null, carType: 'Y' | 'N'): string {
    const parts = ['Hidden.N', 'SellType.일반', `CarType.${carType}`];
    if (manufacturer) parts.push(`Manufacturer.${manufacturer}`);
    if (config.encar.minPriceManwon > 0) parts.push(`Price.range(${config.encar.minPriceManwon}..)`);
    if (config.encar.minYear > 0) parts.push(`Year.range(${config.encar.minYear}01..)`);
    return `(And.${parts.join('._.')}.)`;
  }

  async fetchList(q: string, offset: number, limit: number): Promise<{ count: number; items: EncarListItem[] }> {
    const url = `https://api.encar.com/search/car/list/premium?count=true&q=${encodeURIComponent(q)}&sr=${encodeURIComponent(`|ModifiedDate|${offset}|${limit}`)}`;
    const json = await getJson<{ Count: number; SearchResults: EncarListItem[] }>(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'auto-import-markt/0.2 (+contact via website)' },
      proxyUrl: config.encar.proxyUrl || undefined,
    });
    return { count: json.Count ?? 0, items: json.SearchResults ?? [] };
  }

  async fetchDetail(id: string): Promise<EncarDetail | null> {
    try {
      return await getJson<EncarDetail>(`https://api.encar.com/v1/readside/vehicle/${id}?include=CATEGORY,SPEC,ADVERTISEMENT`, {
        headers: { Accept: 'application/json' }, retries: 1, timeoutMs: 10000, proxyUrl: config.encar.proxyUrl || undefined,
      });
    } catch (e) {
      if (e instanceof HttpError && e.rateLimited) throw e;
      return null;
    }
  }

  async fetchAll(): Promise<ProviderResult> {
    const fetchedAt = new Date().toISOString();
    const warnings: string[] = [];
    const jobs: Array<{ manufacturer: string | null; carType: 'Y' | 'N' }> = config.encar.manufacturers.length
      ? config.encar.manufacturers.map((m) => ({ manufacturer: m, carType: config.encar.importedMakers.includes(m) ? 'N' : 'Y' }))
      : [{ manufacturer: null, carType: 'Y' }];

    // 1) Listen je Hersteller, seitenweise
    const items: EncarListItem[] = [];
    let failedJobs = 0;
    for (const job of jobs) {
      try {
        const q = this.buildQuery(job.manufacturer, job.carType);
        let offset = 0;
        while (offset < config.encar.limitPerMaker) {
          const pageSize = Math.min(config.encar.pageSize, config.encar.limitPerMaker - offset);
          const page = await this.fetchList(q, offset, pageSize);
          items.push(...page.items);
          offset += page.items.length;
          if (page.items.length < pageSize || offset >= page.count) break;
          await sleep(config.encar.delayMs);
        }
      } catch (e) {
        failedJobs++;
        warnings.push(`${job.manufacturer ?? 'alle'}: ${e instanceof Error ? e.message : String(e)}`);
      }
      await sleep(config.encar.delayMs);
    }
    if (failedJobs === jobs.length) throw new Error(`Encar: alle Abfragen fehlgeschlagen – ${warnings.join(' | ')}`);

    // 2) Details mit begrenzter Parallelität (englische Namen, Hubraum)
    const listings: Listing[] = [];
    const queue = [...items];
    let throttled = false;
    const worker = async () => {
      while (queue.length) {
        const item = queue.shift()!;
        let detail: EncarDetail | null = null;
        if (config.encar.fetchDetails && !throttled) {
          try {
            detail = await this.fetchDetail(item.Id);
          } catch (e) {
            throttled = true;
            warnings.push(`Detailabrufe gedrosselt (${e instanceof Error ? e.message : String(e)}); Rest ohne Details`);
          }
          await sleep(config.encar.delayMs);
        }
        const mapped = mapEncar(item, detail, fetchedAt);
        if (mapped) listings.push(mapped);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, config.encar.detailConcurrency) }, worker));

    // Nur ein vollständiger Lauf deaktiviert Fahrzeuge, die nicht mehr gelistet sind
    return { listings, complete: failedJobs === 0, warnings };
  }
}
