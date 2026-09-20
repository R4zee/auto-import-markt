import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapApibara } from '../src/providers/apibara.js';
import { mapAutoApi } from '../src/providers/autoapi.js';
import { ALGOLIA_HIT_LIMIT, detail, dubizzleBody, dubizzleCcm, dubizzleFilters, dubizzleSkipReason, initialBands, mapDubizzle, splitBand } from '../src/providers/dubizzle.js';
import { encarDrive, encarFuel, encarTrim, gradeFromDetail, mapEncar } from '../src/providers/encar.js';
import { mapXapi } from '../src/providers/xapikorea.js';

const NOW = '2026-09-11T10:00:00.000Z';

describe('Encar mapping', () => {
  const item = {
    Id: '42248769', Manufacturer: '현대', Model: '아반떼 AD', Badge: '1.6 GDI 밸류 플러스', FormYear: '2018', Year: 201801,
    Mileage: 59216, Price: 1150, FuelType: '가솔린', Transmission: '오토', OfficeCityState: '부산', SellType: '일반',
    Photos: [{ location: '/carpicture03/pic4223/42239267_002.jpg', ordering: 2 }, { location: '/carpicture03/pic4223/42239267_001.jpg', ordering: 1 }],
  };
  const detail = {
    vehicleId: 42239267,
    category: { manufacturerEnglishName: 'Hyundai', modelGroupEnglishName: 'AVANTE', modelGroupName: '아반떼', modelName: '아반떼 AD', gradeEnglishName: '1.6 GDI Value Plus', formYear: '2018' },
    spec: { displacement: 1591, transmissionName: '오토', fuelName: '가솔린', mileage: 59216 },
  };

  it('rechnet 만원 in KRW um und nutzt englische Namen aus dem Detail', () => {
    const l = mapEncar(item, detail, NOW);
    assert.ok(l);
    assert.equal(l.price, 11_500_000);
    assert.equal(l.currency, 'KRW');
    assert.equal(l.make, 'Hyundai');
    assert.equal(l.model, 'AVANTE');
    assert.equal(l.engineCcm, 1591);
    assert.equal(l.engine, '1.6 L');
    assert.equal(l.market, 'KR');
    assert.equal(l.photos[0], 'https://ci.encar.com/carpicture03/pic4223/42239267_001.jpg');
    assert.equal(l.url, 'https://fem.encar.com/cars/detail/42248769');
    assert.equal(l.fuel, 'Petrol');
    assert.equal(l.transmission, 'Automatic');
  });

  it('fällt ohne Detail auf die Herstellerübersetzung zurück', () => {
    const l = mapEncar(item, null, NOW);
    assert.ok(l);
    assert.equal(l.make, 'Hyundai');
    assert.equal(l.model, '아반떼 AD');
  });

  it('überspringt Leasing-Angebote', () => {
    assert.equal(mapEncar({ ...item, Lease: '1', Price: 10 }, null, NOW), null);
  });

  it('Kraftstoff- und Antriebsheuristik', () => {
    assert.equal(encarFuel('가솔린+전기'), 'Hybrid');
    assert.equal(encarFuel('전기'), 'Electric');
    assert.equal(encarFuel('디젤'), 'Diesel');
    assert.equal(encarFuel('LPG(일반인 구입)'), 'Petrol');
    assert.equal(encarDrive('3.5 AWD Luxury', 'Genesis'), 'AWD');
    assert.equal(encarDrive('2.5 Luxury', 'Genesis'), 'RWD');
    assert.equal(encarDrive('1.6 GDI', 'Hyundai'), 'FWD');
  });
});

describe('Apibara mapping', () => {
  const v = {
    platform: 'copart', lot_number: '54386186', vin: 'WBA4J7C55KBM75906', title: '2019 BMW 440XI GRAN COUPE', year: 2019, make: 'BMW', model: '440XI',
    auction: { state: 'open', auction_at: '2099-07-13T14:00:00+00:00', lot_status: 'Timed', lot_sub_status: 'Open' },
    pricing: { current_bid_usd: 5700, buy_now_usd: null, sale_price_usd: null },
    location: { display: 'Clewiston (FL)', state: 'FL' },
    condition: { primary_damage: 'Front end', has_key: true, run_condition: 'Run & Drive' },
    odometer: { mi: 83726 },
    vehicle_specs: { transmission: 'Automatic', fuel_type: 'Gas', drive_type: 'All wheel drive' },
    media: { photos: ['https://img/1.jpg'] },
    sale_document: { type: 'Clean title' },
  };

  it('bildet ein offenes Copart-Los als Auktion ab', () => {
    const l = mapApibara(v, NOW);
    assert.ok(l);
    assert.equal(l.offerType, 'auction');
    assert.equal(l.auction?.house, 'Copart Clewiston (FL)');
    assert.equal(l.auction?.lot, '54386186');
    assert.equal(l.auction?.grade, 'Run & Drive');
    assert.equal(l.price, 5700);
    assert.equal(l.km, 134744);
    assert.equal(l.drive, 'AWD');
    assert.equal(l.url, 'https://www.copart.com/lot/54386186');
    assert.match(l.trim, /Clean title/);
  });

  it('überspringt beendete Lose und Lose ohne Preis', () => {
    assert.equal(mapApibara({ ...v, auction: { ...v.auction, lot_sub_status: 'Ended' } }, NOW), null);
    assert.equal(mapApibara({ ...v, pricing: { current_bid_usd: 0, buy_now_usd: null, sale_price_usd: null } }, NOW), null);
  });

  it('Buy-Now ohne Auktionstermin wird Festpreis', () => {
    const l = mapApibara({ ...v, auction: { state: 'open' }, pricing: { current_bid_usd: null, buy_now_usd: 9900, sale_price_usd: null } }, NOW);
    assert.equal(l?.offerType, 'fixed');
    assert.equal(l?.price, 9900);
  });
});

describe('auto-api.com mapping (Dubizzle)', () => {
  it('bildet ein Dubizzle-Angebot als Festpreis in AED ab', () => {
    const l = mapAutoApi({
      id: 1, inner_id: 'dz-123', url: 'https://dubai.dubizzle.com/motors/used-cars/nissan/patrol/123', mark: 'Nissan', model: 'Patrol', configuration: 'Nismo',
      year: 2021, price: 245000, km_age: 42600, engine_type: 'Petrol', transmission_type: 'Automatic', address: 'Al Quoz, Dubai', displacement: 5.6,
      images: ['https://img/a.jpg'], extra: { regional_specs: 'GCC', steering: 'Left Hand' },
    }, 'dubizzle', NOW);
    assert.ok(l);
    assert.equal(l.market, 'GCC');
    assert.equal(l.currency, 'AED');
    assert.equal(l.price, 245000);
    assert.equal(l.engineCcm, 5600);
    assert.equal(l.location, 'Al Quoz');
    assert.equal(l.steering, 'LHD');
    assert.match(l.trim, /GCC spec/);
    assert.equal(l.source, 'autoapi-dubizzle');
  });

  it('markiert Rechtslenker (werden im Sync verworfen)', () => {
    const l = mapAutoApi({ inner_id: 'x', mark: 'Toyota', model: 'Land Cruiser', year: 2020, price: 1000, extra: { steering: 'Right Hand' } }, 'dubicars', NOW);
    assert.equal(l?.steering, 'RHD');
  });
});

describe('Dubizzle (Algolia-Proxy) mapping', () => {
  const hit = {
    objectID: '123456', uuid: '9e4d59ce561747d7b86392fb9d3b4a46', name: { en: 'Mercedes-Benz S-Class S 500 2021', ar: 'مرسيدس' },
    price: 250000, is_price_hidden: false, absolute_url: { en: '/motors/used-cars/mercedes-benz/s-class/2026/9/1/s-500-2-ABC/', ar: '/ar/…' },
    photos: { main: 'https://dbz-images.dubizzle.com/images/2026/09/01/a-.jpg' },
    photo_thumbnails: ['https://dbz-images.dubizzle.com/images/2026/09/01/a-.jpg?impolicy=lpv', 'https://dbz-images.dubizzle.com/images/2026/09/01/b-.jpg?impolicy=lpv'],
    photos_count: 12, location_list: { en: ['UAE', 'Dubai', 'Al Quoz'], ar: ['دبي'], ids: [0, 199, 92] }, added: 1758000000, seller_type: 'DL',
    details: {
      Make: { en: { slug: 'mercedes-benz', value: 'Mercedes-Benz' } }, Model: { en: { slug: 's-class', value: 'S-Class' } }, Trim: { en: { value: 'S 500' } },
      Year: { en: { value: '2021' } }, Kilometers: { en: { value: '25000' } }, 'Fuel Type': { en: { value: 'Petrol' } }, 'Transmission Type': { en: { value: 'Automatic Transmission' } },
      'Regional Specs': { en: { value: 'GCC Specs' } }, Horsepower: { en: { value: '400 - 499 HP' } }, 'No. of Cylinders': { en: { value: '8' } },
      'Engine Capacity (cc)': { en: { value: '3000 - 3499 cc' } }, 'Steering Side': { en: { value: 'Left Hand Side' } }, 'Body Type': { en: { value: 'Sedan' } },
    },
    details_v2: { primary: [{ label: { en: 'Trim' }, value: { en: 'S 500' }, slug: 'motors_trim' }] },
  };

  it('bildet einen Treffer als Festpreis in AED mit Marke, Modell, Baujahr, km und Leistung ab', () => {
    const l = mapDubizzle(hit, NOW);
    assert.ok(l);
    assert.equal(l.id, 'dubizzle:9e4d59ce561747d7b86392fb9d3b4a46');
    assert.equal(l.market, 'GCC');
    assert.equal(l.country, 'ae');
    assert.equal(l.currency, 'AED');
    assert.equal(l.price, 250000);
    assert.equal(l.make, 'Mercedes-Benz');
    assert.equal(l.model, 'S-Class');
    assert.equal(l.year, 2021);
    assert.equal(l.km, 25000);
    assert.equal(l.fuel, 'Petrol');
    assert.equal(l.transmission, 'Automatic');
    assert.equal(l.steering, 'LHD');
    assert.equal(l.location, 'Dubai');
    assert.equal(l.engine, '3.3 L 8-cyl');
    assert.equal(l.engineCcm, 3250);
    // Leistungsbereiche („400 - 499 HP“) sind Verkäuferangaben – kein Wert für den Motorisierungsabgleich
    assert.equal(l.powerKw, null);
    assert.match(l.trim, /^S 500 · GCC spec · Sedan · Seller: Dealer$/);
    assert.equal(l.url, 'https://uae.dubizzle.com/motors/used-cars/mercedes-benz/s-class/2026/9/1/s-500-2-ABC/');
    assert.deepEqual(l.photos, ['https://dbz-images.dubizzle.com/images/2026/09/01/a-.jpg', 'https://dbz-images.dubizzle.com/images/2026/09/01/b-.jpg?impolicy=lpv']);
    assert.equal(l.photoCount, 12);
    assert.equal(l.partnerId, 'gulfbridge');
  });

  it('liest Details auch in flacher Schreibweise (details_v2) und markiert Rechtslenker', () => {
    const l = mapDubizzle({ uuid: 'x', name: 'Toyota Land Cruiser', price: 90000, details_v2: { make: 'Toyota', model: 'Land Cruiser', year: 2019, kilometers: '80,000', steering_side: 'Right Hand Side', transmission_type: 'Manual Transmission' } }, NOW);
    assert.ok(l);
    assert.equal(l.make, 'Toyota');
    assert.equal(l.km, 80000);
    assert.equal(l.steering, 'RHD');
    assert.equal(l.transmission, 'Manual');
    assert.equal(detail({ details: { 'No. of Cylinders': { en: { value: '6' } } } }, 'cylinders', 'no_of_cylinders'), '6');
    // details_v2-Listen über slug bzw. Label
    const v2 = { details_v2: { primary: [{ label: { en: 'Steering Side' }, value: { en: 'Right Hand' }, slug: 'steering_side' }, { label: { en: 'Engine Capacity (cc)' }, value: { en: '1991 cc' }, slug: 'engine_capacity_cc' }] } };
    assert.equal(detail(v2, 'steering_side'), 'Right Hand');
    assert.equal(detail(v2, 'Engine Capacity (cc)'), '1991 cc');
    assert.equal(mapDubizzle({ uuid: 'e', name: 'Tesla Model 3', price: 90000, details: { Make: 'Tesla', Model: 'Model 3', Year: '2022', 'Fuel Type': 'Electric', 'Engine Capacity (cc)': '2000 - 2499 cc' } }, NOW)?.engine, 'EV');
  });

  it('liest den Hubraum aus Bereichen und Einzelwerten', () => {
    assert.equal(dubizzleCcm('2000 - 2499 cc'), 2250);
    assert.equal(dubizzleCcm('1991 cc'), 1991);
    assert.equal(dubizzleCcm('1000 - 2999 cc'), null);
    assert.equal(dubizzleCcm(''), null);
  });

  it('überspringt Preis auf Anfrage, reservierte und unvollständige Treffer', () => {
    assert.equal(dubizzleSkipReason({ price: 50000, is_price_hidden: true }), 'Preis auf Anfrage');
    assert.equal(dubizzleSkipReason({ price: 50000, is_reserved: true }), 'reserviert');
    assert.equal(dubizzleSkipReason({ price: 0 }), 'kein Preis');
    assert.equal(dubizzleSkipReason({ price: 50000 }), null);
    assert.equal(mapDubizzle({ uuid: 'y', price: 50000, details: { Make: { en: { value: 'BMW' } } } }, NOW), null);
  });

  it('baut Kategorie- und Preisfilter wie die Website und halbiert Fenster über der 1.000er-Grenze', () => {
    assert.equal(dubizzleFilters([20000, 30000]), '("category_v2.slug_paths":"motors/used-cars") AND price >= 20000 AND price < 30000');
    assert.equal(dubizzleFilters([0, null]), '("category_v2.slug_paths":"motors/used-cars")');
    const body = JSON.parse(dubizzleBody([20000, 30000], 0, 1000)) as { requests: Array<{ indexName: string; params: string }> };
    assert.equal(body.requests[0].indexName, 'motors.com');
    const params = new URLSearchParams(body.requests[0].params);
    assert.equal(params.get('hitsPerPage'), '1000');
    assert.equal(params.get('filters'), dubizzleFilters([20000, 30000]));
    assert.ok(JSON.parse(params.get('attributesToRetrieve')!).includes('details'));
    const bands = initialBands(20000);
    assert.deepEqual(bands[0], [20000, 30000]);
    assert.equal(bands[bands.length - 1][1], null);
    for (let i = 1; i < bands.length; i++) assert.equal(bands[i][0], bands[i - 1][1]);
    assert.deepEqual(splitBand([20000, 30000]), [[20000, 25000], [25000, 30000]]);
    assert.deepEqual(splitBand([1_000_000, null]), [[1_000_000, 1_500_000], [1_500_000, null]]);
    assert.equal(splitBand([20000, 20100]), null);
    assert.equal(ALGOLIA_HIT_LIMIT, 1000);
  });
});

describe('Encar trim', () => {
  it('lässt koreanische Bestandteile weg und dedupliziert', () => {
    const item = { Id: '1', Manufacturer: '현대', Model: '그랜저 IG', Badge: '2.5', BadgeDetail: '프리미엄 초이스' };
    const grade = gradeFromDetail(item, { vehicleId: 1, category: { manufacturerEnglishName: 'Hyundai', modelGroupEnglishName: 'Grandeur', gradeEnglishName: '2.5 Premium' }, spec: { displacement: 2497 } });
    assert.equal(grade.modelEn, 'Grandeur');
    assert.equal(grade.ccm, 2497);
    assert.equal(encarTrim(item, grade), '2.5 Premium · 2.5');
    assert.equal(encarTrim({ Id: '2', Manufacturer: '기아', Model: 'X', Badge: 'Gasoline 2.5T 2WD', BadgeDetail: '(세부등급 없음)' }, null), 'Gasoline 2.5T 2WD');
    // Baureihen-Code aus dem koreanischen Modellnamen bleibt für den Vergleichspreis erhalten
    assert.equal(encarTrim({ Id: '3', Manufacturer: '벤츠', Model: 'E-클래스 W213', Badge: 'E220d 4MATIC' }, null), 'E220d 4MATIC · W213');
    assert.equal(encarTrim({ Id: '4', Manufacturer: 'BMW', Model: '5시리즈 (G30)', Badge: '520d xDrive' }, null), '520d xDrive · G30');
    assert.equal(encarTrim({ Id: '5', Manufacturer: '현대', Model: '그랜저 IG', Badge: '2.5 Premium' }, null), '2.5 Premium', 'unbekannte Codes werden nicht angehängt');
  });
});

describe('xapikorea mapping', () => {
  it('bildet Suchtreffer plus Detail ab (KRW, Hubraum, Antrieb)', () => {
    const l = mapXapi(
      { id: 42248769, manufacturer: 'Hyundai', model: 'Avante', badge: '1.6 GDI Value Plus', year: 2018, mileage_km: 59216, price_krw: 11500000, price_eur: 7300, fuel_type: 'gasoline', transmission: 'automatic', location: 'Busan', thumbnail: 'https://ci.encar.com/a_001.jpg', encar_url: 'https://fem.encar.com/cars/detail/42248769' },
      { id: 42248769, form_year: 2018, engine_cc: 1591, drive_type: 'FWD', photos: ['https://ci.encar.com/a_001.jpg', 'https://ci.encar.com/a_002.jpg'] },
      NOW,
    );
    assert.ok(l);
    assert.equal(l.source, 'xapikorea');
    assert.equal(l.price, 11_500_000);
    assert.equal(l.currency, 'KRW');
    assert.equal(l.engineCcm, 1591);
    assert.equal(l.drive, 'FWD');
    assert.equal(l.photos.length, 2);
    assert.equal(l.url, 'https://fem.encar.com/cars/detail/42248769');
  });

  it('ohne Detail: Thumbnail als Foto, Antrieb Standard', () => {
    const l = mapXapi({ id: '1', manufacturer: 'Kia', model: 'K5', year: 2020, price_krw: 20000000, fuel_type: 'gasoline', transmission: 'automatic', thumbnail: 'https://ci.encar.com/k5.jpg' }, null, NOW);
    assert.equal(l?.photos.length, 1);
    assert.equal(l?.engineCcm, null);
  });
});

describe('Jap Carz mapping', async () => {
  const { japcarzEndsAt, japcarzModel, japcarzSkipReason, japcarzUrl, mapJapCarz } = await import('../src/providers/japcarz.js');
  const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const item = {
    lot: '30016', hash: '41dff98d', slug: '41dff98df95b18e5', title: 'BMW 3 SERIES 325I M-SPORT PACKAGE', subtitle: '3 SERIES 4D 325I M-SPORT PACKAGE',
    make: { name: 'BMW', slug: 'bmw' }, model: { name: '3 SERIES 325I M-SPORT PACKAGE 3 SERIES 4D 325I M-SPORT PACKAGE', slug: 'x' }, year: 2012,
    parsed_mileage: '288000 km', parsed_displacement: '3000', parsed_transmission: 'AT', parsed_starting_bid: '80000', parsed_final_price: null,
    steering_wheel: 'lhd', auction_date: future, auction_time: '08:00', auction_result: 'non Auction', site: 'R-Nagoya', grade_label: '4',
    cover: '/images/41dff98df95b18e5/30016-01.webp', preview_images: ['/images/41dff98df95b18e5/30016-01.webp', '/images/41dff98df95b18e5/30016-02.webp'], photo_count: 7, hasSunroof: true,
  };

  it('bildet ein Auktionslos mit Startgebot in JPY, Modell/Ausstattung aus dem Titel und Termin in japanischer Zeit ab', () => {
    const l = mapJapCarz(item, NOW);
    assert.ok(l);
    assert.equal(l.id, 'japcarz:41dff98df95b18e5');
    assert.equal(l.market, 'JP');
    assert.equal(l.currency, 'JPY');
    assert.equal(l.price, 80000);
    assert.equal(l.offerType, 'auction');
    assert.equal(l.make, 'BMW');
    assert.equal(l.model, '3 Series');
    assert.match(l.trim, /^325I M-sport Package · Sunroof$/i);
    assert.equal(l.km, 288000);
    assert.equal(l.engineCcm, 3000);
    assert.equal(l.engine, '3.0 L');
    assert.equal(l.transmission, 'Automatic');
    assert.equal(l.location, 'Nagoya');
    assert.equal(l.auction?.house, 'Jap Carz · R-Nagoya');
    assert.equal(l.auction?.lot, '30016');
    assert.equal(l.auction?.grade, '4');
    assert.equal(l.auction?.endsAt, new Date(`${future}T08:00:00+09:00`).toISOString());
    assert.deepEqual(l.photos, ['https://jap-carz.com/images/41dff98df95b18e5/30016-01.webp', 'https://jap-carz.com/images/41dff98df95b18e5/30016-02.webp']);
    assert.equal(l.photoCount, 7);
    assert.equal(l.url, 'https://jap-carz.com/listings/41dff98df95b18e5');
    assert.equal(l.partnerId, 'fareast');
  });

  it('überspringt Rechtslenker, versteigerte Lose und zurückliegende Termine', () => {
    assert.equal(japcarzSkipReason({ ...item, steering_wheel: 'rhd' }), 'Rechtslenker');
    assert.equal(japcarzSkipReason({ ...item, parsed_final_price: '150000' }), 'bereits versteigert');
    assert.equal(japcarzSkipReason({ ...item, auction_result: 'Sold' }), 'Auktion beendet (Sold)');
    assert.equal(japcarzSkipReason({ ...item, auction_date: '2020-01-01' }), 'Auktionstermin liegt zurück');
    assert.equal(japcarzSkipReason({ ...item, parsed_starting_bid: null }), 'kein Startgebot');
    assert.equal(japcarzSkipReason(item), null);
  });

  it('trennt Modell und Ausstattung, erkennt Kraftstoff aus dem Titel', () => {
    assert.deepEqual(japcarzModel('ALFA SPORTWAGON 2.5 V6 24V Q SYSTEM', 'ALFA-ROMEO'), { model: 'Alfa Sportwagon', trim: '2.5 V6 24V Q System' });
    assert.deepEqual(japcarzModel('E CLASS E220 CDI'), { model: 'E Class', trim: 'E220 CDI' });
    assert.deepEqual(japcarzModel('CAYENNE TURBO'), { model: 'Cayenne', trim: 'Turbo' });
    const diesel = mapJapCarz({ ...item, title: 'MERCEDES-BENZ E CLASS E220 CDI', make: { name: 'MERCEDES-BENZ' } }, NOW);
    assert.equal(diesel?.make, 'Mercedes-Benz');
    assert.equal(diesel?.model, 'E Class');
    assert.equal(diesel?.fuel, 'Diesel');
    assert.equal(japcarzEndsAt('2026-09-22', '8:00')?.toISOString(), '2026-09-21T23:00:00.000Z');
    assert.equal(japcarzEndsAt('', ''), null);
    assert.equal(japcarzUrl(2, 30, 'upcoming_auctions'), 'https://jap-carz.com/api/listings/?sort=upcoming_auctions&per_page=30&page=2');
  });
});
