import { config } from '../config.js';
import { generationOf } from '../domain/generations.js';
import type { Listing } from '../domain/types.js';
import { encarGradesRepo, gradeKey, type EncarGrade } from '../repositories/listings.js';
import { defaultPartnerFor } from '../seed/partners.js';
import { getJson, HttpError, num, sleep, str } from './http.js';
import { listingId, type MarketProvider, type ProviderResult } from './types.js';

/**
 * Encar (Südkorea) – vollständiger Bestandsabgleich, direkt angebunden.
 *
 * Öffentliche Frontend-Endpunkte (kein Key), Stand 09/2026:
 *   Liste:  GET https://api.encar.com/search/car/list/premium?count=true&q=<Filter>&sr=|ModifiedDate|<offset>|<limit>
 *           Filter: (And.Hidden.N._.SellType.일반._.CarType.Y._.Manufacturer.현대._.Year.range(201801..201812)._.Price.range(1000..1499).)
 *           max. 500 je Seite, Offset + Limit ≤ 10.000 → Teilabfragen nach Baujahr/Preis (Partitionen < 9.500)
 *   Detail: GET https://api.encar.com/v1/readside/vehicle/{id}?include=CATEGORY,SPEC   (englische Namen, Hubraum)
 * Preise in 만원 (×10.000 KRW), Fotos https://ci.encar.com + Pfad.
 * api.encar.com sperrt Rechenzentrums-IPs → aus der Cloud nur über Residential-Proxy (ENCAR_PROXY_URL).
 *
 * Englische Modell-/Ausstattungsnamen und Hubraum kommen nur aus dem Detail. Sie hängen an der
 * Kombination (Hersteller, Modell, Badge) und werden in encar_grades gecacht; je Lauf werden bis zu
 * ENCAR_DETAIL_LIMIT neue Kombinationen nachgeschlagen (häufigste zuerst). Inserate ohne Übersetzung
 * warten bis zum nächsten Lauf.
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
  advertisement?: { price?: number; status?: string };
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

/**
 * Ausstattungszeile nur aus englischen Bestandteilen; koreanische Reste bleiben außen vor. Der Baureihen-Code aus
 * dem koreanischen Modellnamen ("E-클래스 W213", "5시리즈 (G30)") wird angehängt – er bestimmt beim Vergleichspreis
 * das Baujahrband (domain/generations.ts).
 */
export function encarTrim(item: EncarListItem, grade: EncarGrade | null, make = grade?.makeEn || MAKER_EN[item.Manufacturer] || item.Manufacturer): string {
  const parts = [grade?.gradeEn, item.Badge, item.BadgeDetail]
    .map((p) => (p ?? '').trim())
    .filter((p) => p && !HANGUL.test(p) && !p.includes('세부등급'));
  const gen = generationOf({ make, model: item.Model ?? '', trim: '' });
  if (gen && !parts.some((p) => new RegExp(`(^|\\s)${gen.code}(?=\\s|$)`, 'i').test(p))) parts.push(gen.code);
  return Array.from(new Set(parts)).join(' · ');
}

/** Detail → Cache-Eintrag für die Ausstattungskombination */
export function gradeFromDetail(item: EncarListItem, d: EncarDetail): EncarGrade {
  const fuel = encarFuel(d.spec?.fuelName ?? item.FuelType);
  return {
    manufacturer: item.Manufacturer,
    model: item.Model,
    badge: item.Badge ?? '',
    makeEn: d.category?.manufacturerEnglishName ?? null,
    modelEn: d.category?.modelGroupEnglishName ?? null,
    gradeEn: d.category?.gradeEnglishName ?? null,
    ccm: fuel === 'Electric' ? null : d.spec?.displacement ?? null, // bei E-Autos steht dort kein Hubraum
  };
}

export function mapEncarItem(item: EncarListItem, grade: EncarGrade | null, fetchedAt: string): Listing | null {
  const priceManwon = num(item.Price);
  const year = num(item.FormYear) ?? (item.Year ? Math.floor(item.Year / 100) : null);
  if (!priceManwon || priceManwon < 50 || !year || item.Lease === '1') return null;
  const make = grade?.makeEn || MAKER_EN[item.Manufacturer] || item.Manufacturer;
  const model = grade?.modelEn || item.Model;
  const gradeText = grade?.gradeEn || item.Badge || '';
  const fuel = encarFuel(item.FuelType);
  const ccm = fuel === 'Electric' ? null : grade?.ccm ?? null;
  const photos = (item.Photos ?? [])
    .slice()
    .sort((a, b) => (a.ordering ?? 0) - (b.ordering ?? 0))
    .map((p) => `https://ci.encar.com${p.location}`);
  const engine = fuel === 'Electric' ? 'EV' : ccm ? `${(ccm / 1000).toFixed(1)} L` : gradeText.match(/\d\.\d/)?.[0] ?? '';

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
    trim: encarTrim(item, grade, make),
    km: Math.round(num(item.Mileage) ?? 0),
    engine,
    engineCcm: ccm,
    co2Gkm: null,
    transmission: encarTransmission(item.Transmission),
    drive: encarDrive(`${gradeText} ${item.Badge ?? ''}`, make),
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

/** Kompatibilitäts-Helfer: Listeneintrag + Detail direkt abbilden (Tests, Probe). */
export function mapEncar(item: EncarListItem, detail: EncarDetail | null, fetchedAt: string): Listing | null {
  return mapEncarItem(item, detail ? gradeFromDetail(item, detail) : null, fetchedAt);
}

/** Preisklassen (만원) zum Aufteilen großer Partitionen */
const PRICE_BANDS: Array<[number, number | null]> = [[0, 1499], [1500, 1999], [2000, 2999], [3000, 4999], [5000, 7999], [8000, null]];

interface Partition { label: string; q: string; count: number }

export class EncarProvider implements MarketProvider {
  readonly id = 'encar';
  readonly label = 'Encar (Südkorea, Vollabgleich)';

  enabled(): boolean {
    return config.encar.enabled;
  }

  private http() {
    return { headers: { Accept: 'application/json', 'User-Agent': 'auto-import-markt/0.3 (+contact via website)' }, proxyUrl: config.encar.proxyUrl || undefined };
  }

  buildQuery(o: { carType: 'Y' | 'N'; manufacturer?: string | null; year?: number; priceFrom?: number; priceTo?: number | null }): string {
    const parts = ['Hidden.N', 'SellType.일반', `CarType.${o.carType}`];
    if (o.manufacturer) parts.push(`Manufacturer.${o.manufacturer}`);
    const minPrice = Math.max(config.encar.minPriceManwon, o.priceFrom ?? 0);
    if (o.priceTo != null) parts.push(`Price.range(${minPrice}..${o.priceTo})`);
    else if (minPrice > 0) parts.push(`Price.range(${minPrice}..)`);
    if (o.year) parts.push(`Year.range(${o.year}01..${o.year}12)`);
    else if (config.encar.minYear > 0) parts.push(`Year.range(${config.encar.minYear}01..)`);
    return `(And.${parts.join('._.')}.)`;
  }

  async fetchList(q: string, offset: number, limit: number): Promise<{ count: number; items: EncarListItem[] }> {
    const url = `https://api.encar.com/search/car/list/premium?count=true&q=${encodeURIComponent(q)}&sr=${encodeURIComponent(`|ModifiedDate|${offset}|${limit}`)}`;
    // Encar sperrt einzelne Austritts-IPs des Residential-Proxys (HTML-Seite "ERROR", HTTP 403). Der Proxy wechselt die
    // IP je Verbindung → bis zu drei Wiederholungen mit Pause statt Abbruch des gesamten Laufs (15.09.2026)
    const json = await getJson<{ Count: number; SearchResults: EncarListItem[] }>(url, { ...this.http(), timeoutMs: 40000, retries: 3, retryOn403: true, maxRetryWaitMs: 8000 });
    return { count: json.Count ?? 0, items: json.SearchResults ?? [] };
  }

  async fetchDetail(id: string): Promise<EncarDetail> {
    return getJson<EncarDetail>(`https://api.encar.com/v1/readside/vehicle/${id}?include=CATEGORY,SPEC,ADVERTISEMENT`, { ...this.http(), retries: 1, timeoutMs: 15000 });
  }

  /** Zerlegt den Bestand in Teilabfragen unter der 10.000er-Grenze (Baujahr → Preisklasse). */
  async partitions(warnings: string[], state: { skipped: number } = { skipped: 0 }): Promise<Partition[]> {
    const out: Partition[] = [];
    const thisYear = new Date().getFullYear();
    const makers: Array<string | null> = config.encar.manufacturers.length ? config.encar.manufacturers : [null];
    for (const carType of config.encar.carTypes) {
      for (const manufacturer of makers) {
        if (manufacturer && config.encar.importedMakers.includes(manufacturer) !== (carType === 'N')) continue;
        for (let year = config.encar.minYear || 2000; year <= thisYear + 1; year++) {
          const base = { carType, manufacturer, year };
          const q = this.buildQuery(base);
          const label = `${carType}/${manufacturer ?? 'alle'}/${year}`;
          // Ein gesperrter Teilbereich kostet nur diesen Teilbereich, nicht den ganzen Lauf; der Bestand bleibt dort unverändert
          try {
            const { count } = await this.fetchList(q, 0, 1);
            await sleep(config.encar.delayMs);
            if (count === 0) continue;
            if (count <= config.encar.partitionMax) { out.push({ label, q, count }); continue; }
            for (const [from, to] of PRICE_BANDS) {
              const qb = this.buildQuery({ ...base, priceFrom: from, priceTo: to });
              const { count: cb } = await this.fetchList(qb, 0, 1);
              await sleep(config.encar.delayMs);
              if (cb === 0) continue;
              if (cb > config.encar.partitionMax) warnings.push(`${label}/${from}-${to ?? '∞'}: ${cb} Inserate > ${config.encar.partitionMax}, nur die zuletzt geänderten werden geholt`);
              out.push({ label: `${label}/${from}-${to ?? '∞'}`, q: qb, count: Math.min(cb, config.encar.partitionMax) });
            }
          } catch (e) {
            state.skipped++;
            warnings.push(`${label}: Teilabfragen nicht ermittelt – ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`);
          }
        }
      }
    }
    return out;
  }

  async fetchAll(): Promise<ProviderResult> {
    const fetchedAt = new Date().toISOString();
    const warnings: string[] = [];
    const partState = { skipped: 0 };
    const parts = await this.partitions(warnings, partState);
    // Ohne Teilabfragen (alle Zählabfragen gesperrt) abbrechen – sonst gälte ein leerer Lauf als vollständig und
    // deactivateMissing würde den gesamten Bestand deaktivieren
    if (!parts.length) throw new Error(`Encar: keine Teilabfragen ermittelt – ${warnings.slice(0, 2).join(' | ') || 'keine Treffer'}`);
    const expected = parts.reduce((a, p) => a + p.count, 0);

    // 1) Alle Partitionen seitenweise laden – mehrere Partitionen parallel (jede Anfrage kostet über Proxy ~1 s)
    const items = new Map<string, EncarListItem>();
    let failed = 0;
    const partQueue = [...parts];
    const partWorker = async () => {
      while (partQueue.length) {
        const p = partQueue.shift()!;
        try {
          const cap = config.encar.limitPartition > 0 ? Math.min(p.count, config.encar.limitPartition) : p.count;
          for (let offset = 0; offset < cap; offset += config.encar.pageSize) {
            const limit = Math.min(config.encar.pageSize, cap - offset);
            const page = await this.fetchList(p.q, offset, limit);
            for (const it of page.items) items.set(it.Id, it);
            if (page.items.length < limit) break;
            await sleep(config.encar.delayMs);
          }
        } catch (e) {
          failed++;
          warnings.push(`${p.label}: ${e instanceof Error ? e.message : String(e)}`);
          if (e instanceof HttpError && e.rateLimited) await sleep(Math.min(30000, (e.retryAfterSec ?? 10) * 1000));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, config.encar.listConcurrency) }, partWorker));
    if (parts.length && failed === parts.length) throw new Error(`Encar: alle ${parts.length} Teilabfragen fehlgeschlagen – ${warnings.slice(0, 3).join(' | ')}`);

    // 2) Übersetzungs-Cache ergänzen: häufigste unbekannte Kombinationen zuerst
    const grades = await encarGradesRepo.all();
    const missing = new Map<string, { item: EncarListItem; n: number }>();
    for (const it of items.values()) {
      const k = gradeKey(it.Manufacturer, it.Model, it.Badge ?? '');
      if (grades.has(k)) continue;
      const m = missing.get(k);
      if (m) m.n++; else missing.set(k, { item: it, n: 1 });
    }
    const todo = [...missing.values()].sort((a, b) => b.n - a.n).slice(0, config.encar.detailLimit);
    const learned: EncarGrade[] = [];
    let throttled = false;
    const queue = [...todo];
    const worker = async () => {
      while (queue.length && !throttled) {
        const { item } = queue.shift()!;
        try {
          const d = await this.fetchDetail(item.Id);
          const g = gradeFromDetail(item, d);
          learned.push(g);
          grades.set(gradeKey(g.manufacturer, g.model, g.badge), g);
        } catch (e) {
          if (e instanceof HttpError && e.rateLimited) { throttled = true; warnings.push(`Detailabrufe gedrosselt (${e.message})`); }
        }
        await sleep(config.encar.delayMs);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, config.encar.detailConcurrency) }, worker));
    if (learned.length) await encarGradesRepo.upsertMany(learned);

    // 3) Abbilden – nur Inserate mit bekannter Übersetzung
    const listings: Listing[] = [];
    let untranslated = 0;
    for (const it of items.values()) {
      const g = grades.get(gradeKey(it.Manufacturer, it.Model, it.Badge ?? '')) ?? null;
      if (!g || !g.modelEn) { untranslated++; continue; }
      const mapped = mapEncarItem(it, g, fetchedAt);
      if (mapped) listings.push(mapped);
    }
    warnings.push(`Partitionen ${parts.length} (${failed} fehlgeschlagen), erwartet ${expected}, geladen ${items.size}, neue Ausstattungen gelernt ${learned.length} (offen ${Math.max(0, missing.size - learned.length)}), ohne Übersetzung zurückgestellt ${untranslated}`);

    // Nur ein vollständiger Lauf deaktiviert Fahrzeuge, die nicht mehr gelistet sind
    // Nur ein Lauf ohne fehlende Teilbereiche darf verkaufte Inserate deaktivieren
    return { listings, complete: failed === 0 && partState.skipped === 0, warnings };
  }
}
