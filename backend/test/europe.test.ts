import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { marketForCountry } from '../src/domain/markets.js';
import { mapFeedItem } from '../src/providers/feed.js';
import { attr, mapMobileDe } from '../src/providers/mobilede.js';

const NOW = '2026-09-14T10:00:00.000Z';

describe('Süd-/Osteuropa: Länderzuordnung', () => {
  it('ordnet Verkäuferländer den Märkten zu', () => {
    assert.equal(marketForCountry('IT'), 'SE');
    assert.equal(marketForCountry('pt'), 'SE');
    assert.equal(marketForCountry('PL'), 'EE');
    assert.equal(marketForCountry('ro'), 'EE');
    assert.equal(marketForCountry('DE'), null);
    assert.equal(marketForCountry(undefined), null);
  });
});

describe('mobile.de mapping', () => {
  const ad = {
    '@key': '412345678', '@url': 'https://services.mobile.de/search-api/ad/412345678',
    'detail-page': { '@url': 'https://suchen.mobile.de/fahrzeuge/details.html?id=412345678' },
    price: { 'consumer-price-amount': { '@value': '38900', '@currency': 'EUR' } },
    vehicle: {
      make: { '@key': 'BMW' }, model: { '@key': '530' }, 'model-description': { '@value': 'BMW 530 d xDrive Touring M Sport' },
      category: { '@key': 'EstateCar' },
      specifics: {
        'first-registration': { '@value': '202003' }, mileage: { '@value': '78500' }, fuel: { '@key': 'DIESEL' },
        gearbox: { '@key': 'AUTOMATIC_GEAR' }, 'cubic-capacity': { '@value': '2993' }, 'four-wheel-drive': { '@value': 'true' },
        emissions: { 'co2-emission': { '@value': '158' } },
      },
    },
    seller: { type: { '@key': 'DEALER' }, address: { country: { '@key': 'IT' }, city: { '@value': 'Bolzano' } } },
    images: { image: [{ representation: [{ '@size': 'S', '@url': 'https://img.classistatic.de/api/v1/mo-prod/images/1?rule=mo-80.jpg' }, { '@size': 'XXL', '@url': 'https://img.classistatic.de/api/v1/mo-prod/images/1?rule=mo-1600.jpg' }] }] },
  };

  it('bildet ein italienisches Händlerangebot als Festpreis im Markt Südeuropa ab', () => {
    const l = mapMobileDe(ad, NOW);
    assert.ok(l);
    assert.equal(l.id, 'mobilede:412345678');
    assert.equal(l.market, 'SE');
    assert.equal(l.country, 'it');
    assert.equal(l.location, 'Bolzano');
    assert.equal(l.price, 38900);
    assert.equal(l.currency, 'EUR');
    assert.equal(l.year, 2020);
    assert.equal(l.km, 78500);
    assert.equal(l.fuel, 'Diesel');
    assert.equal(l.transmission, 'Automatic');
    assert.equal(l.drive, 'AWD');
    assert.equal(l.engineCcm, 2993);
    assert.equal(l.engine, '3.0 L');
    assert.equal(l.co2Gkm, 158);
    assert.equal(l.trim, 'd xDrive Touring M Sport');
    assert.equal(l.coc, true);
    assert.equal(l.photos[0], 'https://img.classistatic.de/api/v1/mo-prod/images/1?rule=mo-1600.jpg');
    assert.equal(l.url, 'https://suchen.mobile.de/fahrzeuge/details.html?id=412345678');
    assert.equal(l.partnerId, 'adriatica');
  });

  it('polnischer Verkäufer → Osteuropa; deutscher Verkäufer und Nutzfahrzeuge werden übersprungen', () => {
    const pl = mapMobileDe({ ...ad, seller: { address: { country: { '@key': 'PL' }, city: { '@value': 'Poznań' } } } }, NOW);
    assert.equal(pl?.market, 'EE');
    assert.equal(pl?.partnerId, 'carpathia');
    assert.equal(mapMobileDe({ ...ad, seller: { address: { country: { '@key': 'DE' } } } }, NOW), null);
    assert.equal(mapMobileDe({ ...ad, vehicle: { ...ad.vehicle, category: { '@key': 'Van' } } }, NOW), null);
  });

  it('liest auch die flache Schreibweise ohne @-Attribute', () => {
    assert.equal(attr({ key: 'X' }), 'X');
    assert.equal(attr('Y'), 'Y');
    const l = mapMobileDe({
      key: '1', price: { value: 12000, currency: 'EUR' },
      vehicle: { make: 'Skoda', model: 'Octavia', 'model-description': 'Skoda Octavia 2.0 TDI', specifics: { 'first-registration': { '@value': '2019-05' }, mileage: { '@value': 120000 }, fuel: 'DIESEL', gearbox: 'MANUAL_GEAR' } },
      seller: { address: { country: 'cz', city: 'Brno' } },
    }, NOW);
    assert.equal(l?.market, 'EE');
    assert.equal(l?.transmission, 'Manual');
    assert.equal(l?.drive, 'FWD');
    assert.equal(l?.photos.length, 0);
  });
});

describe('Partner-Feed mapping (Süd-/Osteuropa)', () => {
  const mapping = { items: 'cars', id: 'id', year: 'year', make: 'brand', model: 'model', km: 'mileage', price: 'price_eur', photos: 'images', url: 'link', location: 'city' };

  it('leitet Markt und Währung aus dem Land des Feeds ab', () => {
    const l = mapFeedItem({ id: 'A1', year: 2021, brand: 'Dacia', model: 'Duster', mileage: 41000, price_eur: 15900, images: ['https://x/1.jpg'], link: 'https://x/a1', city: 'Cluj' }, mapping, 'feed-carpathia', NOW, { country: 'ro' });
    assert.ok(l);
    assert.equal(l.id, 'feed-carpathia:A1');
    assert.equal(l.market, 'EE');
    assert.equal(l.country, 'ro');
    assert.equal(l.currency, 'EUR');
    assert.equal(l.coc, true);
    assert.equal(l.partnerId, 'carpathia');
    assert.equal(l.location, 'Cluj');
  });

  it('ohne Land bleibt Japan der Standard (Legacy-Feed)', () => {
    const l = mapFeedItem({ id: 'L1', year: 2020, brand: 'Toyota', model: 'Alphard', mileage: 30000, price_eur: 3000000 }, { ...mapping, currency: 'JPY' }, 'jpfeed', NOW);
    assert.equal(l?.market, 'JP');
    assert.equal(l?.currency, 'JPY');
    assert.equal(l?.coc, false);
  });
});
