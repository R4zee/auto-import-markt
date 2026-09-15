import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.REFERENCE_ENABLED = 'true';
process.env.REFERENCE_MAKE_IDS = '{"Hongqi": 99999}';

const { copartBody, copartPhoto, mapCopart } = await import('../src/providers/copart.js');
const { extractItems, firstInt, mapMobileItem, mobileApiUrl, mobileMakeId, mobileSearchParams } = await import('../src/providers/mobilede.js');
const { bucketKey, bucketQuery, detailFrom, diffPct, engineMatches, kmWindow, summarize, variantText } = await import('../src/services/reference.js');
import type { RefBucket } from '../src/services/reference.js';

const NOW = '2026-09-15T10:00:00.000Z';

describe('Vergleichspreise DE – Suchtext und Fenster', () => {
  it('Variantentext: Ziffern-Kennung aus der Ausstattung, sonst Modell; Mercedes mit Leerzeichen', () => {
    assert.equal(variantText({ make: 'BMW', model: '3 Series', trim: '320d xDrive M Sport' }), '320d');
    assert.equal(variantText({ make: 'BMW', model: '5 Series (G30)', trim: '520d' }), '520d');
    assert.equal(variantText({ make: 'BMW', model: '3 Series', trim: 'M Sport' }), '3');
    assert.equal(variantText({ make: 'Audi', model: 'A6', trim: '40 TDI' }), 'A6');
    assert.equal(variantText({ make: 'Mercedes-Benz', model: 'E-Class', trim: 'E220d 4MATIC Avantgarde' }), 'E 220 d');
    assert.equal(variantText({ make: 'Mercedes-Benz', model: 'GLC-Class', trim: 'GLC300 4MATIC' }), 'GLC 300');
    assert.equal(variantText({ make: 'Hyundai', model: 'Tucson', trim: '1.6 T-GDI Premium' }), 'Tucson');
    assert.equal(variantText({ make: 'Hyundai', model: 'Ioniq 5', trim: 'Long Range AWD' }), 'Ioniq 5');
    assert.equal(variantText({ make: 'Volkswagen', model: 'Golf', trim: 'GTI' }), 'Golf');
    assert.equal(variantText({ make: 'Mercedes-Benz', model: 'C-Class', trim: 'Avantgarde' }), 'C');
  });

  it('Laufleistungsfenster: ±50 % unter 100.000 km, ±30 % darüber', () => {
    assert.deepEqual(kmWindow(80_000), { from: 40_000, to: 120_000 });
    assert.deepEqual(kmWindow(150_000), { from: 105_000, to: 195_000 });
    assert.deepEqual(kmWindow(100_000), { from: 70_000, to: 130_000 });
  });

  it('Bucket: Baujahr ±1, Kraftstoff, Marken-ID nötig; Überschreibung per REFERENCE_MAKE_IDS', () => {
    const q = bucketQuery({ make: 'BMW', model: '3 Series', trim: '320d', year: 2019, fuel: 'Diesel' });
    assert.ok(q);
    assert.equal(q.yearFrom, 2018); assert.equal(q.yearTo, 2020); assert.equal(q.description, '320d');
    assert.equal(bucketKey(q), 'mobilede|bmw|320d|Diesel|2018-2020');
    assert.equal(bucketQuery({ make: 'Unbekannt', model: 'X', trim: '', year: 2019, fuel: 'Petrol' }), null);
    assert.equal(mobileMakeId('Hongqi'), 99999);
    assert.equal(mobileMakeId('mercedes benz'), 17200);
  });

  it('Motorisierung: Hubraum ±12 %, unbekannter Hubraum schließt nicht aus', () => {
    const s = { priceEur: 1, year: 2019, km: 1, kw: null, ccm: 1995, title: '', url: null };
    assert.ok(engineMatches({ engineCcm: 1995 }, s));
    assert.ok(engineMatches({ engineCcm: 2143 }, s));
    assert.ok(!engineMatches({ engineCcm: 2993 }, s));
    assert.ok(engineMatches({ engineCcm: null }, s));
    assert.ok(engineMatches({ engineCcm: 2993 }, { ...s, ccm: null }));
  });
});

describe('Vergleichspreise DE – Zusammenfassung', () => {
  const bucket: RefBucket = {
    key: 'mobilede|bmw|320d|Diesel|2018-2020', source: 'mobilede',
    query: { make: 'BMW', description: '320d', yearFrom: 2018, yearTo: 2020, fuel: 'Diesel' },
    samples: [
      { priceEur: 17_900, year: 2018, km: 190_000, kw: 140, ccm: 1995, title: 'BMW 320d Touring', url: 'https://suchen.mobile.de/a' },
      { priceEur: 21_500, year: 2019, km: 95_000, kw: 140, ccm: 1995, title: 'BMW 320d', url: 'https://suchen.mobile.de/b' },
      { priceEur: 22_900, year: 2019, km: 60_000, kw: 140, ccm: 1995, title: 'BMW 320d xDrive', url: 'https://suchen.mobile.de/c' },
      { priceEur: 24_900, year: 2020, km: 45_000, kw: 195, ccm: 2993, title: 'BMW 330d', url: 'https://suchen.mobile.de/d' },
    ],
    total: 412, url: 'https://suchen.mobile.de/fahrzeuge/search.html?…', fetchedAt: NOW,
  };

  it('günstigstes Angebot im km-Fenster mit passendem Hubraum, Abstand des Endpreises in Prozent', () => {
    const s = summarize({ km: 80_000, engineCcm: 1995 }, 18_060, bucket);
    assert.ok(s);
    assert.equal(s.count, 2, '95k und 60k km liegen im Fenster 40k–120k; 190k nicht; 330d hat anderen Hubraum');
    assert.equal(s.minEur, 21_500);
    assert.equal(s.url, 'https://suchen.mobile.de/b');
    assert.equal(s.diffPct, -16);
    assert.equal(s.kmFrom, 40_000); assert.equal(s.kmTo, 120_000);
    assert.equal(s.yearFrom, 2018); assert.equal(s.yearTo, 2020);
  });

  it('ohne vergleichbares Angebot null; Detailansicht liefert dann count 0', () => {
    assert.equal(summarize({ km: 10_000, engineCcm: 1995 }, 30_000, bucket), null);
    const d = detailFrom({ km: 10_000, engineCcm: 1995 }, 30_000, bucket);
    assert.equal(d.count, 0); assert.equal(d.minEur, null); assert.equal(d.diffPct, null);
  });

  it('hohe Laufleistung nutzt das 30-%-Fenster', () => {
    const s = summarize({ km: 160_000, engineCcm: null }, 20_000, bucket);
    assert.ok(s);
    assert.equal(s.count, 1);
    assert.equal(s.minEur, 17_900);
    assert.equal(diffPct(20_000, 17_900), 11.7);
  });
});

describe('mobile.de – URL und Antwort', () => {
  it('Suchparameter: Marke;;;Beschreibung, Erstzulassungsband, Kraftstoff, günstigste zuerst, nur DE, unbeschädigt', () => {
    const sp = mobileSearchParams({ make: 'BMW', description: '320d', yearFrom: 2018, yearTo: 2020, fuel: 'Diesel' });
    assert.equal(sp.get('ms'), '3500;;;320d');
    assert.equal(sp.get('fr'), '2018:2020');
    assert.equal(sp.get('ft'), 'DIESEL');
    assert.equal(sp.get('sb'), 'p'); assert.equal(sp.get('od'), 'up');
    assert.equal(sp.get('cn'), 'DE'); assert.equal(sp.get('dam'), '0');
    assert.ok(mobileApiUrl({ make: 'BMW', description: '320d', yearFrom: 2018, yearTo: 2020, fuel: null }, 1, 'query').startsWith('https://www.mobile.de/consumer/api/search/srp?isSearchRequest=true'));
    assert.ok(mobileApiUrl({ make: 'BMW', description: '320d', yearFrom: 2018, yearTo: 2020, fuel: null }, 2, 'url').includes(encodeURIComponent('pageNumber=2')));
  });

  it('Zahlen aus Anzeigetexten', () => {
    assert.equal(firstInt('85.000 km'), 85_000);
    assert.equal(firstInt('12.900 €'), 12_900);
    assert.equal(firstInt('140 kW (190 PS)'), 140);
    assert.equal(firstInt('1.995 cm³'), 1995);
    assert.equal(firstInt(21500), 21500);
  });

  it('Treffer aus searchResults.items, Werbeplätze ohne Preis verworfen', () => {
    const json = {
      searchResults: {
        numResultsTotal: 412, numPages: 21, hasNextPage: true,
        items: [
          { id: 123, title: 'BMW 320d Touring Sport Line', price: { gross: '21.500 €', grossAmount: 21500, currency: 'EUR' }, attr: { fr: '03/2019', ml: '95.000 km', pw: '140 kW (190 PS)', ft: 'Diesel', tr: 'Automatik', cc: '1.995 cm³' }, relativeUrl: '/fahrzeuge/details.html?id=123' },
          { type: 'ad', adSlot: 'top' },
          { id: 124, title: 'BMW 320d', price: { gross: '17.900 €' }, attr: { fr: '06/2018', ml: '190.000 km' } },
        ],
      },
    };
    const items = extractItems(json);
    assert.equal(items.length, 3);
    const mapped = items.map(mapMobileItem);
    assert.deepEqual(mapped[0], { priceEur: 21500, year: 2019, km: 95000, kw: 140, ccm: 1995, title: 'BMW 320d Touring Sport Line', url: 'https://suchen.mobile.de/fahrzeuge/details.html?id=123' });
    assert.equal(mapped[1], null);
    assert.equal(mapped[2]?.priceEur, 17900);
    assert.equal(mapped[2]?.url, 'https://suchen.mobile.de/fahrzeuge/details.html?id=124');
  });
});

describe('Copart (USA) – Anfrage und Zuordnung', () => {
  it('Anfragekörper: Pkw-Filter, optional Marken, Seite/Größe', () => {
    const b = copartBody(2, 100, ['BMW']) as { filter: Record<string, string[]>; page: number; size: number; start: number };
    assert.deepEqual(b.filter.MISC, ['#VehicleTypeCode:VEHTYPE_V']);
    assert.deepEqual(b.filter.MAKE, ['#Make:BMW']);
    assert.equal(b.page, 2); assert.equal(b.size, 100); assert.equal(b.start, 200);
  });

  it('laufende Auktion mit Gebot, Meilen → km, Vorschaubild → Vollbild', () => {
    const future = Date.now() + 3 * 86400000;
    const l = mapCopart({ ln: 55512345, mkn: 'BMW', lm: '330I', lmg: '3 SERIES', lcy: 2019, orr: 45210, ord: 'M', hb: 8200, bnp: 0, ad: future, yn: 'CA - LOS ANGELES', dd: 'FRONT END', ft: 'GAS', tmtp: 'AUTOMATIC', drv: 'Rear-wheel Drive', egn: '2.0L 4', cy: 4, tims: 'https://cs.copart.com/v1/AUTH_svc.pdoc00001/lpp/0925/abc_thb.jpg', tt: 'CLEAN TITLE', lcd: 'Run and Drive', hk: 'YES' }, NOW);
    assert.ok(l);
    assert.equal(l.id, 'copart:55512345');
    assert.equal(l.make, 'BMW'); assert.equal(l.model, '3 SERIES');
    assert.equal(l.km, 72_758);
    assert.equal(l.price, 8200); assert.equal(l.currency, 'USD');
    assert.equal(l.offerType, 'auction');
    assert.equal(l.auction?.house, 'Copart CA - LOS ANGELES');
    assert.equal(l.auction?.grade, 'Run and Drive');
    assert.ok(l.auction?.gradeNote?.includes('Keys present'));
    assert.equal(l.engineCcm, 2000); assert.equal(l.engine, '2.0 L 4-cyl');
    assert.equal(l.fuel, 'Petrol'); assert.equal(l.drive, 'RWD');
    assert.equal(l.photos[0], 'https://cs.copart.com/v1/AUTH_svc.pdoc00001/lpp/0925/abc_ful.jpg');
    assert.equal(l.location, 'LOS ANGELES');
    assert.ok(l.trim.includes('Title: CLEAN TITLE') && l.trim.includes('Damage: FRONT END'));
  });

  it('abgelaufene Auktion ohne Sofortkauf entfällt; Sofortkauf ohne Termin ist Festpreis', () => {
    assert.equal(mapCopart({ ln: 1, mkn: 'FORD', lm: 'F-150', lcy: 2018, orr: 10, hb: 500, bnp: 0, ad: Date.now() - 86400000 }, NOW), null);
    const l = mapCopart({ ln: 2, mkn: 'FORD', lm: 'F-150', lcy: 2018, orr: 10, hb: 0, bnp: 15000 }, NOW);
    assert.equal(l?.offerType, 'fixed'); assert.equal(l?.price, 15000);
    assert.equal(copartPhoto('x_thb.jpg'), 'x_ful.jpg');
  });
});
