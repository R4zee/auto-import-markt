/**
 * Frische-Test für xapikorea.com gegen Encar live (von einer Wohnsitz-IP ausführen):
 *   XAPIKOREA_API_KEY=… node --import tsx src/cli/check-xapikorea.ts [Marke=Hyundai] [n=30]
 *
 * Misst:
 *  1. Wie viele der neuesten xapikorea-Treffer sind bei Encar noch inseriert (Detail-Endpunkt)?
 *  2. Stimmen Preis und Kilometer mit Encar live überein?
 *  3. Welcher Anteil der neuesten Encar-Inserate (gleiche Marke) ist bei xapikorea schon vorhanden?
 */
import { getJson, sleep } from '../providers/http.js';

const key = process.env.XAPIKOREA_API_KEY ?? '';
if (!key) {
  console.error('XAPIKOREA_API_KEY fehlt (kostenloser Key: https://xapikorea.com, 500 Anfragen/Monat).');
  process.exit(1);
}
const brand = process.argv[2] ?? 'Hyundai';
const n = Math.min(50, Number(process.argv[3] ?? 30));
const brandKo: Record<string, string> = { Hyundai: '현대', Kia: '기아', Genesis: '제네시스', BMW: 'BMW', 'Mercedes-Benz': '벤츠' };

interface XItem { id: string | number; manufacturer?: string; model?: string; year?: number; mileage_km?: number; price_krw?: number; encar_url?: string }
interface EncarItem { Id: string; Price?: number; Mileage?: number; Manufacturer?: string; Model?: string }
interface EncarDetail { vehicleId: number; advertisement?: { price?: number; status?: string }; spec?: { mileage?: number } }

const xh = { 'X-API-Key': key, Accept: 'application/json' };
const x = await getJson<{ total_count: number; results: XItem[] }>(
  `https://api.xapikorea.com/v1/search?brand=${encodeURIComponent(brand)}&limit=${n}&sort=ModifiedDate&lang=en`, { headers: xh },
);
console.log(`xapikorea: ${x.total_count} ${brand}-Treffer insgesamt, prüfe die ${x.results.length} neuesten gegen Encar live …`);

let live = 0, gone = 0, priceDiff = 0, kmDiff = 0, errors = 0;
for (const item of x.results) {
  try {
    const d = await getJson<EncarDetail>(`https://api.encar.com/v1/readside/vehicle/${item.id}?include=ADVERTISEMENT,SPEC`, { retries: 0, timeoutMs: 10000 });
    const status = d.advertisement?.status ?? '';
    if (status && status !== 'ADVERTISE') gone++; else live++;
    const encarKrw = (d.advertisement?.price ?? 0) * 10000;
    if (item.price_krw && encarKrw && Math.abs(encarKrw - item.price_krw) > 1) priceDiff++;
    if (item.mileage_km && d.spec?.mileage && Math.abs(d.spec.mileage - item.mileage_km) > 1) kmDiff++;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/HTTP 404/.test(msg)) gone++; else errors++;
  }
  await sleep(150);
}
console.log(`  noch inseriert: ${live}/${x.results.length} · verkauft/entfernt: ${gone} · Preis abweichend: ${priceDiff} · km abweichend: ${kmDiff} · Fehler: ${errors}`);

// Gegenrichtung: neueste Encar-Inserate der Marke → schon bei xapikorea?
const ko = brandKo[brand];
if (ko) {
  const q = `(And.Hidden.N._.SellType.일반._.CarType.${/^(BMW|Mercedes-Benz)$/.test(brand) ? 'N' : 'Y'}._.Manufacturer.${ko}.)`;
  const e = await getJson<{ Count: number; SearchResults: EncarItem[] }>(
    `https://api.encar.com/search/car/list/premium?count=true&q=${encodeURIComponent(q)}&sr=${encodeURIComponent(`|ModifiedDate|0|${n}`)}`,
  );
  let found = 0, missing = 0;
  for (const it of e.SearchResults) {
    try {
      await getJson(`https://api.xapikorea.com/v1/cars/${it.Id}`, { headers: xh, retries: 0 });
      found++;
    } catch (err) {
      if (/HTTP 404/.test(err instanceof Error ? err.message : '')) missing++; else errors++;
    }
    await sleep(250); // Free-Plan: 5 Anfragen/Minute – bei 429 den Wert n verkleinern
  }
  console.log(`Encar live: ${e.Count} ${brand}-Inserate; von den ${e.SearchResults.length} zuletzt geänderten sind bei xapikorea vorhanden: ${found}, fehlen: ${missing}`);
}
console.log('Verbrauchte xapikorea-Anfragen in diesem Lauf: ca.', 1 + (ko ? n : 0));
