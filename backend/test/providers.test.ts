import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapApibara } from '../src/providers/apibara.js';
import { mapAutoApi } from '../src/providers/autoapi.js';
import { carapisPrice, guessDrive, mapCarapis, parseSources, prettyBrand, prettyModel } from '../src/providers/carapis.js';
import { encarDrive, encarFuel, mapEncar } from '../src/providers/encar.js';

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

describe('Carapis mapping (apix/catalog_api)', () => {
  it('parst die Quellen-Zuordnung', () => {
    assert.deepEqual(parseSources('encar:KR, dubizzle:GCC ,goonet:JP'), [
      { source: 'encar', market: 'KR' }, { source: 'dubizzle', market: 'GCC' }, { source: 'goonet', market: 'JP' },
    ]);
  });

  it('bereinigt Slug-artige Marken- und Modellnamen', () => {
    assert.equal(prettyBrand('Bmw'), 'BMW');
    assert.equal(prettyBrand('Kg Mobility'), 'KG Mobility');
    assert.equal(prettyBrand('mercedes-benz'), 'Mercedes-Benz');
    assert.equal(prettyBrand('Hyundai'), 'Hyundai');
    assert.equal(prettyModel('3Series'), '3 Series');
    assert.equal(prettyModel('Gs300'), 'GS300');
    assert.equal(prettyModel('e-class'), 'E-Class');
    assert.equal(prettyModel('Grandeur'), 'Grandeur');
    assert.equal(prettyModel('Cooper S Convertible'), 'Cooper S Convertible');
  });

  it('schätzt den Antrieb aus Hinweisen und Marke', () => {
    assert.equal(guessDrive('awd', '', 'Hyundai'), 'AWD');
    assert.equal(guessDrive('', '3.5 HTRAC Luxury', 'Genesis'), 'AWD');
    assert.equal(guessDrive('', 'Club · pickup', 'SsangYong'), '4WD');
    assert.equal(guessDrive('', '2.0 LTZ · sedan', 'Chevrolet'), 'FWD');
    assert.equal(guessDrive('unknown', 'STD · sedan', 'Lexus'), 'RWD');
  });

  it('bevorzugt den Originalpreis der Quelle, sonst USD', () => {
    assert.deepEqual(carapisPrice({ price: 28500000, currency: 'KRW' }, 'KRW'), { price: 28500000, currency: 'KRW' });
    assert.deepEqual(carapisPrice({ price_original: 12500, currency: 'EUR', price_usd: 13600 }, 'EUR'), { price: 12500, currency: 'EUR' });
    assert.deepEqual(carapisPrice({ price_usd: 13600 }, 'KRW'), { price: 13600, currency: 'USD' });
    assert.equal(carapisPrice({}, 'KRW'), null);
  });

  it('bildet ein Encar-Fahrzeug mit Slug-Feldern ab', () => {
    const l = mapCarapis({
      id: '3f1c9a7e-1111-2222-3333-444455556666', source: 'encar', brand_name: 'Hyundai', brand_slug: 'hyundai', model_name: 'Grandeur', model_slug: 'grandeur',
      trim: '3.5 Calligraphy', year: 2022, mileage: 31500, price: 28500000, currency: 'KRW', location: 'Seoul', fuel_type: 'gasoline', transmission: 'auto',
      body_type: 'sedan', engine_cc: 3470, photos: ['https://p/1.jpg', { url: 'https://p/2.jpg' }], url: 'https://fem.encar.com/cars/detail/38217645', has_accident: false,
    }, 'KR', NOW, 'encar');
    assert.ok(l);
    assert.equal(l.country, 'kr');
    assert.equal(l.make, 'Hyundai');
    assert.equal(l.model, 'Grandeur');
    assert.equal(l.price, 28_500_000);
    assert.equal(l.currency, 'KRW');
    assert.equal(l.offerType, 'fixed');
    assert.equal(l.fuel, 'Petrol');
    assert.equal(l.transmission, 'Automatic');
    assert.equal(l.engineCcm, 3470);
    assert.deepEqual(l.photos, ['https://p/1.jpg', 'https://p/2.jpg']);
    assert.match(l.trim, /sedan/);
  });

  it('bildet die echte Carapis-Listenantwort ab (price_usd, region, Foto-Objekte)', () => {
    const l = mapCarapis({
      id: '990599e3-fbe9-4d11-934b-6c702d41e3bf', source_code: 'encar', brand_name: 'Kia', brand_slug: 'kia', model_name: 'Sportage', model_slug: 'sportage',
      trim: 'Trendy', year: 2014, price_usd: 6400, mileage: 114972, fuel_type: 'diesel', transmission: 'auto', body_type: 'suv', color: 'white',
      seller_type: 'dealer', region: 'Gyeonggi', source_location: null, has_accident: false, is_new_vehicle: false,
      photos: [
        { url: '/media/vehicles/990/599/x.webp', thumb_url: '/media/x.webp', original_url: 'https://ci.encar.com/carpicture08/pic3978/39781874_001.jpg?rw=1280', is_main: true, position: 0 },
        { url: 'https://ci.encar.com/carpicture08/pic3978/39781874_002.jpg?rw=1280', original_url: 'https://ci.encar.com/carpicture08/pic3978/39781874_002.jpg?rw=1280', is_main: false, position: 1 },
      ],
      photos_count: 26,
    }, 'KR', NOW, 'encar');
    assert.ok(l);
    assert.equal(l.price, 6400);
    assert.equal(l.currency, 'USD');
    assert.equal(l.location, 'Gyeonggi');
    assert.equal(l.fuel, 'Diesel');
    assert.equal(l.drive, 'FWD');
    assert.equal(l.photos.length, 2);
    assert.match(l.photos[0], /39781874_001/);
    assert.equal(l.photoCount, 26);
    assert.equal(l.steering, 'LHD');
  });

  it('japanische Inlandsquellen gelten ohne LHD-Hinweis als Rechtslenker', () => {
    const jp = mapCarapis({ id: 'j1', brand_name: 'Toyota', model_name: 'Land Cruiser', trim: 'ZX', year: 2022, price_usd: 60000, fuel_type: 'gasoline', transmission: 'auto' }, 'JP', NOW, 'goonet_exchange');
    assert.equal(jp?.steering, 'RHD');
    const lhd = mapCarapis({ id: 'j2', brand_name: 'Toyota', model_name: 'Land Cruiser', trim: 'ZX LHD export', year: 2022, price_usd: 60000, fuel_type: 'gasoline', transmission: 'auto' }, 'JP', NOW, 'goonet_exchange');
    assert.equal(lhd?.steering, 'LHD');
  });

  it('kommt mit verschachtelten brand/model-Objekten und USD-Preis zurecht', () => {
    const l = mapCarapis({ id: 'x1', brand: { name: 'Nissan', slug: 'nissan' }, model: { name: 'Patrol' }, year: 2021, price_usd: 66700, mileage_km: 42600, fuel_type: 'gasoline', transmission: 'auto', images: [] }, 'GCC', NOW, 'dubizzle');
    assert.ok(l);
    assert.equal(l.make, 'Nissan');
    assert.equal(l.currency, 'USD');
    assert.equal(l.price, 66700);
    assert.equal(l.km, 42600);
  });

  it('EU-Quellen gelten als EU-Ware mit COC', () => {
    const l = mapCarapis({ id: 'm1', brand: 'BMW', model: 'M4', year: 2021, price: 67200, currency: 'EUR', fuel_type: 'gasoline', transmission: 'auto' }, 'EE', NOW, 'mobile_de');
    assert.equal(l?.coc, true);
  });
});
