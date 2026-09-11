import { config } from '../config.ts';
import type { Listing } from '../domain/types.ts';
import { defaultPartnerFor } from '../seed/partners.ts';
import { getJson, num, sleep, str } from './http.ts';
import { listingId, type MarketProvider, type ProviderResult } from './types.ts';

/**
 * Encar (Südkorea) – größter Gebrauchtwagenmarktplatz. Kein offizielles API; die
 * Frontend-Endpunkte sind öffentlich und ohne Key erreichbar (Stand 09/2026):
 *   Liste:  https://api.encar.com/search/car/list/premium?count=true&q=…&sr=…
 *   Detail: https://api.encar.com/v1/readside/vehicle/{id}
 * Preise stehen in 만원 (×10.000 KRW). Rechtlich ist das ein undokumentierter
 * Endpunkt → nur mit ENCAR_ENABLED=true aktiv, konservativ gedrosselt.
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
    modelName?: string; gradeName?: string; gradeEnglishName?: string; yearMonth?: string; formYear?: string; domestic?: boolean;
  };
  spec?: { mileage?: number; displacement?: number; transmissionName?: string; fuelName?: string; bodyName?: string };
  advertisement?: { price?: number };
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

export function mapEncar(item: EncarListItem, detail: EncarDetail | null, fetchedAt: string): Listing | null {
  const priceManwon = num(item.Price);
  const year = num(item.FormYear) ?? (item.Year ? Math.floor(item.Year / 100) : null);
  if (!priceManwon || priceManwon < 50 || !year || item.Lease === '1') return null;
  const cat = detail?.category;
  const make = cat?.manufacturerEnglishName || MAKER_EN[item.Manufacturer] || item.Manufacturer;
  const model = cat?.modelGroupEnglishName || item.Model;
  const grade = cat?.gradeEnglishName || item.Badge || '';
  const badgeDetail = (item.BadgeDetail ?? '').includes('세부등급 없음') ? '' : item.BadgeDetail ?? '';
  const trimParts = [grade, badgeDetail, cat?.modelGroupEnglishName && cat.modelName !== cat.modelGroupName ? cat.modelName : null].filter(Boolean);
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
    trim: trimParts.join(' · '),
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
    return `(And.${parts.join('._.')}.)`;
  }

  async fetchList(q: string, offset: number, limit: number): Promise<EncarListItem[]> {
    const url = `https://api.encar.com/search/car/list/premium?count=true&q=${encodeURIComponent(q)}&sr=${encodeURIComponent(`|ModifiedDate|${offset}|${limit}`)}`;
    const json = await getJson<{ Count: number; SearchResults: EncarListItem[] }>(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'auto-import-markt/0.1 (+contact via website)' },
    });
    return json.SearchResults ?? [];
  }

  async fetchDetail(id: string): Promise<EncarDetail | null> {
    try {
      return await getJson<EncarDetail>(`https://api.encar.com/v1/readside/vehicle/${id}?include=CATEGORY,SPEC,ADVERTISEMENT`, {
        headers: { Accept: 'application/json' }, retries: 1, timeoutMs: 10000,
      });
    } catch {
      return null;
    }
  }

  async fetchAll(): Promise<ProviderResult> {
    const fetchedAt = new Date().toISOString();
    const listings: Listing[] = [];
    const jobs: Array<{ manufacturer: string | null; carType: 'Y' | 'N' }> = config.encar.manufacturers.length
      ? config.encar.manufacturers.map((m) => ({ manufacturer: m, carType: config.encar.importedMakers.includes(m) ? 'N' : 'Y' }))
      : [{ manufacturer: null, carType: 'Y' }];

    for (const job of jobs) {
      const items = await this.fetchList(this.buildQuery(job.manufacturer, job.carType), 0, config.encar.limitPerMaker);
      for (const item of items) {
        const detail = config.encar.fetchDetails ? await this.fetchDetail(item.Id) : null;
        const mapped = mapEncar(item, detail, fetchedAt);
        if (mapped) listings.push(mapped);
        if (config.encar.fetchDetails) await sleep(config.encar.delayMs);
      }
      await sleep(config.encar.delayMs);
    }
    // Ein Sync deckt nur die konfigurierten Hersteller/Seiten ab, daher als vollständig für
    // diese Quelle behandeln: Fahrzeuge, die nicht mehr erscheinen, gelten als verkauft.
    return { listings, complete: true };
  }
}
