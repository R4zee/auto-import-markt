import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.REFERENCE_ENABLED = 'true';
process.env.REFERENCE_MAKE_IDS = '{"Hongqi": 99999}';

const { copartBody, copartPhoto, copartSkipReason, mapCopart } = await import('../src/providers/copart.js');
const { extractItems, extractResolvedModel, firstInt, mapMobileItem, mobileApiUrl, mobileMakeId, mobileSearchParams, mobileSeoUrl } = await import('../src/providers/mobilede.js');
const { bucketKey, bucketQuery, detailFrom, diffPct, engineMatches, kmBandFor, kmWindow, summarize, titleMatches, variantText } = await import('../src/services/reference.js');
const { powerKwFromText } = await import('../src/providers/types.js');
const { generationOf, yearBand } = await import('../src/domain/generations.js');
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

  it('Laufleistungsfenster: nur nach oben, +50 % unter 100.000 km, +30 % darüber', () => {
    assert.deepEqual(kmWindow(80_000), { from: 0, to: 120_000 });
    assert.deepEqual(kmWindow(150_000), { from: 0, to: 195_000 });
    assert.deepEqual(kmWindow(100_000), { from: 0, to: 130_000 });
  });

  it('Laufleistungsband für die Suche: Fenster-Obergrenze auf 25.000 aufgerundet, min. 50.000, über 300.000 offen', () => {
    assert.equal(kmBandFor(80_000), 125_000);
    assert.equal(kmBandFor(10_000), 50_000);
    assert.equal(kmBandFor(100_000), 150_000);
    assert.equal(kmBandFor(200_000), 275_000);
    assert.equal(kmBandFor(250_000), null);
  });

  it('Bucket: Baujahr ±1 ohne Baureihe, Kraftstoff, km-Band, Marken-ID nötig; Überschreibung per REFERENCE_MAKE_IDS', () => {
    const q = bucketQuery({ make: 'BMW', model: '3 Series', trim: '320d', year: 2019, fuel: 'Diesel', km: 80_000 });
    assert.ok(q);
    assert.equal(q.yearFrom, 2018); assert.equal(q.yearTo, 2020); assert.equal(q.description, '320d'); assert.equal(q.generation, null); assert.equal(q.kmTo, 125_000);
    assert.equal(bucketKey(q), 'mobilede|bmw|320d|Diesel|2018-2020|km125000');
    assert.equal(bucketQuery({ make: 'BMW', model: '3 Series', trim: '320d', year: 2019, fuel: 'Diesel', km: 0, kmBand: 125_000 })?.kmTo, 125_000, 'Refresh-Job übergibt das Band aus SQL');
    assert.equal(bucketQuery({ make: 'Unbekannt', model: 'X', trim: '', year: 2019, fuel: 'Petrol', km: 1 }), null);
    assert.equal(mobileMakeId('Hongqi'), 99999);
    assert.equal(mobileMakeId('mercedes benz'), 17200);
  });

  it('Baureihe im Inserat → Bauzeitraum statt Baujahr ±1 (2011er W221 zählt zur 2013er, W222 nicht)', () => {
    const w221 = bucketQuery({ make: 'Mercedes-Benz', model: 'S-Class W221', trim: 'S350 CDI 4MATIC', year: 2013, fuel: 'Diesel', km: 80_000 });
    assert.ok(w221);
    assert.equal(w221.generation, 'W221'); assert.equal(w221.yearFrom, 2005); assert.equal(w221.yearTo, 2013); assert.equal(w221.description, 'S 350');
    const w222 = bucketQuery({ make: 'Mercedes-Benz', model: 'S-Class (W222)', trim: 'S350d', year: 2014, fuel: 'Diesel', km: 80_000 });
    assert.ok(w222);
    assert.equal(w222.generation, 'W222'); assert.equal(w222.yearFrom, 2013); assert.equal(w222.yearTo, 2020);
    assert.notEqual(bucketKey(w221), bucketKey(w222));
    const e93 = bucketQuery({ make: 'BMW', model: '3 Series (E93)', trim: '320i Convertible', year: 2012, fuel: 'Petrol', km: 80_000 });
    assert.equal(e93?.generation, 'E93'); assert.equal(e93?.yearFrom, 2005); assert.equal(e93?.yearTo, 2013);
    assert.equal(generationOf({ make: 'Mercedes-Benz', model: 'E-Class', trim: 'E220 CDI', year: 2012 }), null, 'Variante E220 ist kein BMW-Code');
    assert.equal(generationOf({ make: 'BMW', model: '5 Series', trim: 'F10 520d', year: 2014 })?.code, 'F10');
    assert.equal(generationOf({ make: 'Audi', model: 'A6', trim: 'C7 3.0 TDI', year: 2015 })?.code, 'C7');
    assert.equal(generationOf({ make: 'Hyundai', model: 'Tucson', trim: 'C7', year: 2015 }), null, 'Audi-Codes nur bei Audi');
    const running = yearBand({ make: 'Porsche', model: '911 (992)', trim: 'Carrera S', year: 2021 }, 1, 2026);
    assert.deepEqual(running, { from: 2019, to: 2026, generation: '992' });
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
    assert.equal(s.count, 2, '95k und 60k km liegen bis 120k; 190k nicht; 330d hat anderen Hubraum');
    assert.equal(s.minEur, 21_500);
    assert.equal(s.url, 'https://suchen.mobile.de/b');
    assert.equal(s.diffPct, -16);
    assert.equal(s.kmFrom, 0); assert.equal(s.kmTo, 120_000);
    assert.equal(s.yearFrom, 2018); assert.equal(s.yearTo, 2020);
    assert.equal(s.generation, null);
  });

  it('ohne vergleichbares Angebot null; Detailansicht liefert dann count 0', () => {
    assert.equal(summarize({ km: 10_000, engineCcm: 1995 }, 30_000, bucket), null);
    const d = detailFrom({ km: 10_000, engineCcm: 1995 }, 30_000, bucket);
    assert.equal(d.count, 0); assert.equal(d.minEur, null); assert.equal(d.diffPct, null);
  });

  it('hohe Laufleistung nutzt +30 %; Angebote mit weniger km bleiben vergleichbar', () => {
    const s = summarize({ km: 160_000, engineCcm: null }, 20_000, bucket);
    assert.ok(s);
    assert.equal(s.count, 3, 'alle 320d bis 208.000 km; der 330d fällt über den Titelabgleich heraus');
    assert.equal(s.minEur, 17_900);
    assert.equal(diffPct(20_000, 17_900), 11.7);
  });

  it('Leistung ±15 % (mindestens 8 kW), wenn beide Seiten sie kennen', () => {
    const s = { priceEur: 1, year: 2019, km: 1, kw: 140, ccm: null, title: 'BMW 320d', url: null };
    assert.ok(engineMatches({ engineCcm: null, powerKw: 140 }, s));
    assert.ok(engineMatches({ engineCcm: null, powerKw: 155 }, s));
    assert.ok(!engineMatches({ engineCcm: null, powerKw: 195 }, s));
    assert.ok(engineMatches({ engineCcm: null, powerKw: null }, s));
    assert.ok(engineMatches({ engineCcm: null, powerKw: 195 }, { ...s, kw: null }));
    assert.equal(powerKwFromText('140 kW (190 PS)'), 140);
    assert.equal(powerKwFromText('190 KM'), 140);
    assert.equal(powerKwFromText('224 CP'), 165);
    assert.equal(powerKwFromText('150 cv'), 110);
    assert.equal(powerKwFromText('258'), 190);
    assert.equal(powerKwFromText('2.0 TDI'), null);
    assert.equal(powerKwFromText(null), null);
  });

  it('Modellabgleich über mobile.de-Modellname/Titel (Live-Antwort 15.09.2026: "S350" traf auch CLS/E/GLK 350)', () => {
    const hit = (model: string, title: string) => titleMatches('S 350', { model, title });
    assert.ok(hit('Mercedes-Benz S 350', 'Mercedes-Benz S 350 BlueTEC L'));
    assert.ok(hit('', 'Mercedes-Benz Hiermit möchte ich mein S 350 AMG Line ver...'));
    assert.ok(hit('', 'Mercedes-Benz S350 CDI 4MATIC'));
    assert.ok(!hit('Mercedes-Benz CLS 350', 'Mercedes-Benz CLS 350 CDI Automatik*Xenon*Leder*Navi*SD'));
    assert.ok(!hit('Mercedes-Benz E 350', 'Mercedes-Benz E 350 CDI T BlueEFFICIENCY Standard'));
    assert.ok(!hit('Mercedes-Benz GLK 350', 'Mercedes-Benz GLK 350 NAVI LIDER'));
    assert.ok(!hit('', 'Mercedes-Benz Mercedes Benz R Klasse 350 7 Sitzer Lang'));
    assert.ok(!hit('', 'Mercedes-Benz Mercedes S212, E350 CDI, 265 PS'));
    assert.ok(titleMatches('320d', { model: 'BMW 320', title: 'BMW 320 3 Touring 320 d Sport Line' }), 'Ziffern und Buchstabe getrennt');
    assert.ok(titleMatches('320d', { title: 'BMW 320d xDrive Touring' }));
    assert.ok(!titleMatches('320d', { title: 'BMW 330d xDrive' }));
    assert.ok(!titleMatches('320d', { title: 'BMW 320i Sport Line' }));
    assert.ok(titleMatches('E 220 d', { title: 'Mercedes-Benz E 220 CDI T Avantgarde' }), 'Endbuchstabe optional (CDI statt d)');
    assert.ok(titleMatches('Tucson', { title: 'Hyundai TUCSON 1.6 T-GDI Premium' }));
    assert.ok(!titleMatches('Tucson', { title: 'Hyundai Santa Fe 2.2 CRDi' }));
    assert.ok(titleMatches('Ioniq 5', { title: 'Hyundai IONIQ 5 77.4 kWh' }));
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
    assert.equal(sp.get('ml'), null);
    const withBand = mobileSearchParams({ make: 'Mercedes-Benz', description: 'S 350', yearFrom: 2005, yearTo: 2013, fuel: 'Diesel', kmTo: 125_000, modelId: 10 });
    assert.equal(withBand.get('ms'), '17200;10;;', 'Modell-ID statt Freitext');
    assert.equal(withBand.get('ml'), ':125000');
    const group = mobileSearchParams({ make: 'Mercedes-Benz', description: 'S 350', yearFrom: 2005, yearTo: 2013, fuel: 'Diesel', modelGroupId: 16 });
    assert.equal(group.get('ms'), '17200;;16;', 'Modellgruppe (S-Klasse = 16, Live-Probe 15.09.2026)');
    assert.ok(mobileApiUrl({ make: 'BMW', description: '320d', yearFrom: 2018, yearTo: 2020, fuel: null }, 1, 'query').startsWith('https://www.mobile.de/consumer/api/search/srp?isSearchRequest=true'));
    assert.ok(mobileApiUrl({ make: 'BMW', description: '320d', yearFrom: 2018, yearTo: 2020, fuel: null }, 2, 'url').includes(encodeURIComponent('pageNumber=2')));
  });

  it('SEO-Modellseite: englische Modellnamen eingedeutscht, IDs aus filters.ms', () => {
    assert.equal(mobileSeoUrl('Mercedes-Benz', 'S-Class'), 'https://suchen.mobile.de/auto/mercedes-benz-s-klasse.html');
    assert.equal(mobileSeoUrl('Mercedes-Benz', 'E-Class (W213)'), 'https://suchen.mobile.de/auto/mercedes-benz-e-klasse.html');
    assert.equal(mobileSeoUrl('BMW', '3 Series'), 'https://suchen.mobile.de/auto/bmw-3er.html');
    assert.equal(mobileSeoUrl('BMW', '5 Series (G30)'), 'https://suchen.mobile.de/auto/bmw-5er.html');
    assert.equal(mobileSeoUrl('Hyundai', 'Tucson'), 'https://suchen.mobile.de/auto/hyundai-tucson.html');
    assert.equal(mobileSeoUrl('Škoda', 'Octavia'), 'https://suchen.mobile.de/auto/skoda-octavia.html');
    assert.equal(mobileSeoUrl('Land Rover', 'Range Rover Sport'), 'https://suchen.mobile.de/auto/land-rover-range-rover-sport.html');
    // Live-Antwort 15.09.2026 für /auto/mercedes-benz-s-klasse.html: S-Klasse ist eine Modellgruppe
    const r = extractResolvedModel({ filters: { ms: [{ make: '17200', model: '', modelGroup: '16', modelDescription: '' }] }, chips: { makeModel: [{ label: 'Mercedes-Benz S-Klasse' }] } }, 'u');
    assert.deepEqual(r, { makeId: 17200, modelId: null, modelGroupId: 16, label: 'Mercedes-Benz S-Klasse', url: 'u' });
    assert.equal(extractResolvedModel({ filters: {} }, 'u').modelId, null);
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

  it('abgelaufene Auktion ohne Sofortkauf entfällt; Sofortkauf ohne Termin ist Festpreis; nur USA', () => {
    assert.equal(mapCopart({ ln: 1, mkn: 'FORD', lm: 'F-150', lcy: 2018, orr: 10, hb: 500, bnp: 0, ad: Date.now() - 86400000 }, NOW), null);
    assert.equal(copartSkipReason({ ln: 1, hb: 500, bnp: 0, ad: Date.now() - 86400000 }), 'Auktionstermin liegt zurück, kein Sofortkauf');
    assert.equal(copartSkipReason({ ln: 1, hb: 0, bnp: 0, ad: Date.now() + 86400000 }), 'noch kein Gebot, kein Sofortkauf');
    assert.equal(copartSkipReason({ ln: 1, hb: 900, ad: Date.now() + 86400000, locCountry: 'CAN' }), 'nicht USA');
    const l = mapCopart({ ln: 2, mkn: 'FORD', lm: 'F-150', lcy: 2018, orr: 10, hb: 0, bnp: 15000 }, NOW);
    assert.equal(l?.offerType, 'fixed'); assert.equal(l?.price, 15000);
    assert.equal(copartPhoto('x_thb.jpg'), 'x_ful.jpg');
  });

  it('Live-Antwort 15.09.2026: Titelart, Standort, Slug-URL, Tachobewertung', () => {
    const lot = {
      ln: 73672065, mkn: 'KIA', lmg: 'FORTE', lm: 'FORTE', ltd: 'GT', lcy: 2021, orr: 77968, ord: 'ACTUAL', odometerUOM: 'A', egn: '1.6L  4', cy: '4',
      yn: 'WA - SPANAWAY', ad: Date.now() + 5 * 86400000, hb: 550, bnp: 0, tgc: 'TITLEGROUP_S', tgd: 'SALVAGE TITLE', td: 'BILL OF SALE', dd: 'REAR END',
      tims: 'https://cs.copart.com/v1/AUTH_svc.pdoc00001/lpp/0226/426146574f484073bb7768cc26f78005_thb.jpg', locCountry: 'USA', locCity: 'SPANAWAY', locState: 'WA',
      tmtp: 'AUTOMATIC', lcd: 'RUNS AND DRIVES', ft: 'GAS', hk: 'YES', drv: 'Front-wheel Drive', ldu: 'salvage-2021-kia-forte-gt-wa-spanaway',
    };
    const l = mapCopart(lot, NOW);
    assert.ok(l);
    assert.equal(l.make, 'Kia'); assert.equal(l.model, 'FORTE');
    assert.equal(l.trim, 'GT · Title: SALVAGE TITLE · Damage: REAR END');
    assert.equal(l.location, 'SPANAWAY');
    assert.equal(l.url, 'https://www.copart.com/lot/73672065/salvage-2021-kia-forte-gt-wa-spanaway');
    assert.equal(l.km, 125_477);
    assert.equal(l.engine, '1.6 L 4-cyl'); assert.equal(l.engineCcm, 1600);
    assert.equal(l.auction?.grade, 'RUNS AND DRIVES');
    const notActual = mapCopart({ ...lot, ord: 'NOT ACTUAL' }, NOW);
    assert.ok(notActual?.trim.endsWith('Odometer: NOT ACTUAL'));
  });
});
