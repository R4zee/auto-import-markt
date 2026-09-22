import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.REFERENCE_ENABLED = 'true';
process.env.REFERENCE_MAKE_IDS = '{"Hongqi": 99999}';

const { copartBody, copartPhoto, copartSkipReason, mapCopart } = await import('../src/providers/copart.js');
const { extractItems, extractResolvedModel, firstInt, flattenModelList, mapMobileItem, matchModel, mobileApiUrl, mobileMakeId, mobileSearchParams, mobileSeoUrl, normModelLabel } = await import('../src/providers/mobilede.js');
const { bucketKey, bucketQuery, detailFrom, diffPct, engineMatches, isOneOff, kmBandFor, kmWindow, referenceUpdates, summarize, titleMatches, variantText } = await import('../src/services/reference.js');
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
    // Sondermodelle bei Exoten stehen bei mobile.de im Freitext → Kennung anhängen (Superveloce → SV)
    assert.equal(variantText({ make: 'Lamborghini', model: 'Aventador', trim: 'LP 750-4 Superveloce' }), 'Aventador SV');
    assert.equal(variantText({ make: 'Lamborghini', model: 'Aventador SVJ', trim: 'Roadster' }), 'Aventador SVJ');
    assert.equal(variantText({ make: 'Lamborghini', model: 'Huracan', trim: 'LP 640-4 Performante Spyder' }), 'Huracan Performante');
    assert.equal(variantText({ make: 'Lamborghini', model: 'Aventador', trim: 'LP 700-4' }), 'Aventador');
    assert.equal(variantText({ make: 'Porsche', model: '911', trim: 'GT3 RS Weissach' }), '911 GT3 RS');
    assert.equal(variantText({ make: 'Porsche', model: '911', trim: 'Carrera S' }), '911');
    assert.equal(variantText({ make: 'Ferrari', model: '488', trim: 'Pista Spider' }), '488 Pista');
    // Titelabgleich: Basis zusammenhängend, Kennung irgendwo in einer ihrer Schreibweisen
    assert.ok(titleMatches('Aventador SV', { model: 'Aventador', title: 'Lamborghini Aventador LP 750-4 Superveloce Roadster' }));
    assert.ok(titleMatches('Aventador SV', { model: 'Aventador', title: 'Lamborghini Aventador SV LP750-4' }));
    assert.ok(!titleMatches('Aventador SV', { model: 'Aventador', title: 'Lamborghini Aventador LP 700-4' }));
    assert.ok(!titleMatches('Aventador SV', { model: 'Aventador', title: 'Lamborghini Aventador SVJ' }));
    assert.ok(titleMatches('Aventador Spyder', { model: 'Aventador', title: 'Lamborghini Aventador S Roadster' }));
    assert.ok(titleMatches('911 GT3 RS', { model: '911', title: 'Porsche 911 GT3RS Weissach' }));
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
    // Kia Sportage: keine Baureihen-Familie hinterlegt → Baujahr ±1
    const q = bucketQuery({ make: 'Kia', model: 'Sportage', trim: '2.0 CRDi', year: 2019, fuel: 'Diesel', km: 80_000 });
    assert.ok(q);
    assert.equal(q.yearFrom, 2018); assert.equal(q.yearTo, 2020); assert.equal(q.description, 'Sportage'); assert.equal(q.generation, null); assert.equal(q.kmTo, 125_000);
    assert.equal(bucketKey(q), 'mobilede|kia|sportage|Diesel|2018-2020|km125000');
    // Leistung bekannt → Leistungsband im Schlüssel und Suchfenster mit Rand (X6 xDrive30d 195 kW: Band 175–210 → 148–242 kW);
    // OLX-Kategorie „X6 M“ mit Serienmotor in der Ausstattung → „X6“
    const kw = bucketQuery({ make: 'BMW', model: 'X6 M', trim: 'X6 xDrive30d M Sport', year: 2020, fuel: 'Diesel', km: 156_000, powerKw: 195 });
    assert.equal(kw?.kwFrom, 148); assert.equal(kw?.kwTo, 242);
    assert.equal(bucketKey(kw!), 'mobilede|bmw|x6|Diesel|2019-2026|km225000|kw148-242');
    assert.equal(variantText({ make: 'BMW', model: 'X6 M', trim: 'Competition · SUV' }), 'X6 M', 'echtes M-Modell bleibt');
    assert.equal(variantText({ make: 'BMW', model: 'X5 M', trim: 'M50d 400cp' }), 'X5');
    assert.equal(bucketQuery({ make: 'BMW', model: 'X6 M', trim: 'Competition', year: 2020, fuel: 'Petrol', km: 50_000, powerKw: 460 })?.kwTo, 598);
    assert.equal(bucketQuery({ make: 'BMW', model: 'X6 M', trim: 'Competition', year: 2020, fuel: 'Petrol', km: 50_000, powerKw: 700 })?.kwTo, null, 'oberstes Band offen');
    // BMW 320d 2019 ohne Code: Familie 3er → F30 (2012–2019, Wechseljahr → auslaufende Reihe)
    const f30 = bucketQuery({ make: 'BMW', model: '3 Series', trim: '320d', year: 2019, fuel: 'Diesel', km: 80_000 });
    assert.equal(f30?.generation, 'F30'); assert.equal(f30?.yearFrom, 2012); assert.equal(f30?.yearTo, 2019);
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

  it('ohne Code: Baureihe aus Modellfamilie + Baujahr, im Wechseljahr die auslaufende Reihe', () => {
    // 2020er Maybach S 650 → W222 (2013–2020), nicht Baujahr ±1 – der 2018er S 650 auf mobile.de zählt mit
    const maybach = bucketQuery({ make: 'Mercedes-Benz', model: 'Maybach S-Class', trim: 'S650', year: 2020, fuel: 'Petrol', km: 73_488 });
    assert.equal(maybach?.generation, 'W222'); assert.equal(maybach?.yearFrom, 2013); assert.equal(maybach?.yearTo, 2020); assert.equal(maybach?.description, 'S 650');
    assert.equal(yearBand({ make: 'Mercedes-Benz', model: 'S-Class', trim: 'S 500 4MATIC', year: 2021 }, 1, 2026).generation, 'W223');
    assert.equal(yearBand({ make: 'Mercedes-Benz', model: 'E-Class', trim: 'E220d', year: 2018 }, 1, 2026).generation, 'W213');
    assert.equal(yearBand({ make: 'Mercedes-Benz', model: 'E 63 AMG', trim: '4MATIC+', year: 2017 }, 1, 2026).generation, 'W213');
    // GLS/CLS treffen die S-Klasse nicht (Wortgrenze), GLS hat keine Familie → Baujahr ±1
    assert.deepEqual(yearBand({ make: 'Mercedes-Benz', model: 'GLS', trim: 'GLS 450', year: 2019 }, 1, 2026), { from: 2018, to: 2020, generation: null });
    assert.equal(yearBand({ make: 'Mercedes-Benz', model: 'CLS', trim: 'CLS 350 d', year: 2019 }, 1, 2026).generation, 'C257');
    assert.equal(yearBand({ make: 'BMW', model: '5 Series', trim: '530d xDrive', year: 2018 }, 1, 2026).generation, 'G30');
    assert.equal(yearBand({ make: 'BMW', model: '5 Series', trim: '530d', year: 2017 }, 1, 2026).generation, 'F10', 'Wechseljahr → auslaufende Reihe');
    assert.equal(yearBand({ make: 'BMW', model: 'X5', trim: 'xDrive40d', year: 2016 }, 1, 2026).generation, 'F15');
    assert.equal(yearBand({ make: 'Porsche', model: 'Cayenne', trim: 'Turbo', year: 2019 }, 1, 2026).generation, '9Y0');
    assert.equal(yearBand({ make: 'Audi', model: 'A6', trim: '3.0 TDI quattro', year: 2016 }, 1, 2026).generation, 'C7');
    assert.equal(yearBand({ make: 'Volkswagen', model: 'Golf', trim: '2.0 TSI GTI', year: 2020 }, 1, 2026).generation, 'Golf 7');
    assert.equal(yearBand({ make: 'Land Rover', model: 'Range Rover Sport', trim: '3.0 SDV6', year: 2015 }, 1, 2026).generation, 'L494');
    assert.equal(yearBand({ make: 'Land Rover', model: 'Range Rover', trim: '4.4 SDV8', year: 2015 }, 1, 2026).generation, 'L405');
    // Baujahr vor der ersten bekannten Reihe oder fremde Marke → Baujahr ±1
    assert.equal(yearBand({ make: 'BMW', model: '3 Series', trim: '318i', year: 1988 }, 1, 2026).generation, null);
    assert.deepEqual(yearBand({ make: 'Hyundai', model: 'Tucson', trim: '2.0 CRDi', year: 2019 }, 1, 2026), { from: 2018, to: 2020, generation: null });
    // Exoten: das Modell ist die Baureihe
    assert.deepEqual(yearBand({ make: 'Lamborghini', model: 'Aventador', trim: 'LP 750-4 Superveloce', year: 2016 }, 1, 2026), { from: 2011, to: 2022, generation: 'Aventador' });
    assert.equal(yearBand({ make: 'Lamborghini', model: 'Huracán', trim: 'EVO', year: 2020 }, 1, 2026).generation, 'Huracán');
    assert.equal(yearBand({ make: 'Ferrari', model: '488 GTB', trim: '', year: 2017 }, 1, 2026).generation, '488');
    assert.equal(yearBand({ make: 'McLaren', model: '720S', trim: 'Performance', year: 2019 }, 1, 2026).generation, '720S');
    // expliziter Code gewinnt vor der Familie
    assert.equal(yearBand({ make: 'BMW', model: '3 Series (E93)', trim: '320i', year: 2012 }, 1, 2026).generation, 'E93');
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

  it('ein einzelnes Angebot ist keine Referenz; Einzelstücke (gepanzert, 1of1) zählen nicht mit', () => {
    const one = { ...bucket, samples: [bucket.samples[1]] };
    assert.equal(summarize({ km: 80_000, engineCcm: 1995 }, 18_060, one), null);
    const d = detailFrom({ km: 80_000, engineCcm: 1995 }, 18_060, one);
    assert.equal(d.count, 1); assert.equal(d.minEur, null); assert.equal(d.diffPct, null);
    assert.ok(isOneOff('BMW 760i x Drive/VR9 Factory Armored,/2026/T1/No VAT'));
    assert.ok(isOneOff('BMW X6 M Competition 1of1 Hamann Full Package 23"'));
    assert.ok(!isOneOff('BMW X6 M Competition Panorama Soft-Close Vollleder'));
    const armored = { ...bucket, samples: [...bucket.samples, { priceEur: 9_000, year: 2019, km: 50_000, kw: 140, ccm: 1995, title: 'BMW 320d gepanzert VR4', url: null }] };
    assert.equal(summarize({ km: 80_000, engineCcm: 1995 }, 18_060, armored)?.minEur, 21_500, 'gepanzerter 9.000-€-Wagen bleibt außen vor');
  });

  it('Auktionen: Vergleichspreis ja, Abstand nein (Preis ist nur das Start-/Höchstgebot)', () => {
    const s = summarize({ km: 80_000, engineCcm: 1995, offerType: 'auction' }, 4_100, bucket);
    assert.ok(s);
    assert.equal(s.minEur, 21_500); assert.equal(s.count, 2);
    assert.equal(s.diffPct, null, 'Copart-Los mit 175 $ Gebot darf nicht als −94 % vorn stehen');
    const d = detailFrom({ km: 80_000, engineCcm: 1995, offerType: 'auction' }, 4_100, bucket);
    assert.equal(d.minEur, 21_500); assert.equal(d.diffPct, null);
    assert.equal(summarize({ km: 80_000, engineCcm: 1995, offerType: 'fixed' }, 18_060, bucket)?.diffPct, -16);
    // Job-Spalten: Abstand rechnet SQL aus Endpreis und Angebotsart der Zeile zum Schreibzeitpunkt (kein Schnappschuss)
    const stmts = referenceUpdates([
      { id: 'copart:1', km: 80_000, engine_ccm: 1995, power_kw: null, ref_min_eur: null },
      { id: 'x:2', km: 10_000, engine_ccm: 1995, power_kw: null, ref_min_eur: null },
      { id: 'x:3', km: 80_000, engine_ccm: 1995, power_kw: null, ref_min_eur: 21_500 },
    ], bucket);
    assert.equal(stmts.length, 2, 'unveränderter Vergleichspreis wird nicht geschrieben (Schreibkontingent)');
    const s0 = stmts[0] as { sql: string; args: unknown[] };
    assert.match(s0.sql, /ref_diff_de = CASE WHEN \? > 0 AND landed_de IS NOT NULL AND offer_type <> 'auction' THEN ROUND\(\(landed_de - \?\) \* 1000\.0 \/ \?\) \/ 10\.0 ELSE NULL END/);
    assert.deepEqual(s0.args, [21_500, ...Array(12).fill(21_500), 'copart:1']);
    assert.deepEqual((stmts[1] as { args: unknown[] }).args, [0, ...Array(12).fill(0), 'x:2'], 'kein vergleichbares Angebot → 0 = geprüft');
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
    const resolvedMake = mobileSearchParams({ make: 'Land Rover', description: 'Discovery Sport', yearFrom: 2017, yearTo: 2019, fuel: 'Diesel', modelId: 11, makeId: 14600 });
    assert.equal(resolvedMake.get('ms'), '14600;11;;', 'Marken-ID aus der SEO-Auflösung übersteuert die Tabelle');
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
    const { raw, ...ids } = r;
    assert.ok(raw);
    assert.deepEqual(ids, { makeId: 17200, modelId: null, modelGroupId: 16, label: 'Mercedes-Benz S-Klasse', url: 'u' });
    // Modellliste (Probe 21.09.2026, BMW): Gruppen als optgroups, Einzelmodelle mit value/label
    const list = flattenModelList([
      { optgroupLabel: '7er Reihe', items: [{ value: '24', label: '7er Reihe (Alle)', isGroup: true }, { value: '33', label: '725' }, { value: '39', label: '760' }] },
      { optgroupLabel: 'M-Modelle', items: [{ value: '25', label: 'M-Modelle (Alle)', isGroup: true }, { value: '99', label: 'M760' }, { value: '87', label: 'X6 M' }] },
      { optgroupLabel: 'X-Reihe', items: [{ value: '26', label: 'X-Reihe (Alle)', isGroup: true }, { value: '49', label: 'X6' }] },
      { value: '336', label: 'i7' },
    ]);
    assert.equal(list.length, 9);
    assert.deepEqual(matchModel(list, '7-Series', '760i'), { modelId: 39, modelGroupId: null, label: '760' }, 'Variante vor Gruppe');
    assert.deepEqual(matchModel(list, '7 Series', '7'), { modelId: null, modelGroupId: 24, label: '7er Reihe (Alle)' }, '„7 Series“ → Gruppe 7er');
    assert.deepEqual(matchModel(list, 'X6 M', 'X6 M'), { modelId: 87, modelGroupId: null, label: 'X6 M' }, 'exakt vor Präfix („X6“)');
    assert.deepEqual(matchModel(list, 'X6', 'X6'), { modelId: 49, modelGroupId: null, label: 'X6' });
    assert.deepEqual(matchModel(list, '7 Series', 'M760e'), { modelId: 99, modelGroupId: null, label: 'M760' });
    assert.equal(matchModel(list, 'Tucson', 'Tucson'), null);
    assert.equal(normModelLabel('S-Class'), 'sklasse'); assert.equal(normModelLabel('S-Klasse (Alle)'), 'sklasse');
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
    assert.equal(l.make, 'BMW'); assert.equal(l.model, '3 Series');
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
    assert.equal(l.make, 'Kia'); assert.equal(l.model, 'Forte');
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

describe('Vergleichspreis-Spalten je Inserat', async () => {
  const { refKeyFor } = await import('../src/services/reference.js');
  const { refDiffSql } = await import('../src/db.js');
  it('ref_key entspricht dem Bucket-Schlüssel, leer ohne bekannte Marke', () => {
    const key = refKeyFor({ make: 'BMW', model: '3 Series', trim: '320d M Sport', year: 2019, fuel: 'Diesel', km: 80000 });
    assert.match(key, /^mobilede\|bmw\|320d\|Diesel\|\d{4}-\d{4}\|km\d+$/);
    assert.equal(refKeyFor({ make: 'Unbekannte Marke XY', model: 'Z', trim: '', year: 2019, fuel: 'Petrol', km: 1000 }), '');
  });
  it('SQL-Abstand rechnet wie diffPct() und nur für Festpreise', () => {
    const sql = refDiffSql('20000', '17900');
    assert.match(sql, /ROUND\(\(20000 - 17900\) \* 1000\.0 \/ 17900\) \/ 10\.0/);
    assert.match(sql, /offer_type <> 'auction'/);
    assert.match(refDiffSql('excluded.landed_de', 'listings.ref_min_eur', 'excluded.offer_type'), /listings\.ref_min_eur > 0 AND excluded\.landed_de IS NOT NULL AND excluded\.offer_type <> 'auction'/);
  });
});

describe('Laufleistungsfenster mit Untergrenze', async () => {
  const { kmWindow } = await import('../src/services/reference.js');
  it('Fahrzeuge unter 20.000 km werden mit allen bis 20.000 km verglichen', () => {
    assert.deepEqual(kmWindow(1_600), { from: 0, to: 20_000 });
    assert.deepEqual(kmWindow(12_000), { from: 0, to: 20_000 });
    assert.deepEqual(kmWindow(30_000), { from: 0, to: 45_000 });
    assert.deepEqual(kmWindow(150_000), { from: 0, to: 195_000 });
  });
});
