import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapApibara } from '../src/providers/apibara.js';
import { mapAutoApi } from '../src/providers/autoapi.js';
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

describe('Encar trim', () => {
  it('lässt koreanische Bestandteile weg und dedupliziert', () => {
    const item = { Id: '1', Manufacturer: '현대', Model: '그랜저 IG', Badge: '2.5', BadgeDetail: '프리미엄 초이스' };
    const grade = gradeFromDetail(item, { vehicleId: 1, category: { manufacturerEnglishName: 'Hyundai', modelGroupEnglishName: 'Grandeur', gradeEnglishName: '2.5 Premium' }, spec: { displacement: 2497 } });
    assert.equal(grade.modelEn, 'Grandeur');
    assert.equal(grade.ccm, 2497);
    assert.equal(encarTrim(item, grade), '2.5 Premium · 2.5');
    assert.equal(encarTrim({ Id: '2', Manufacturer: '기아', Model: 'X', Badge: 'Gasoline 2.5T 2WD', BadgeDetail: '(세부등급 없음)' }, null), 'Gasoline 2.5T 2WD');
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
