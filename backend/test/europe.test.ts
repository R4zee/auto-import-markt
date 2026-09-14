import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { marketForCountry } from '../src/domain/markets.js';
import { mapFeedItem } from '../src/providers/feed.js';
import { makeFromTitle, mapOlxOffer, olxPhoto } from '../src/providers/olx.js';
import { mapSauto, sautoImage, sautoYear } from '../src/providers/sauto.js';
import { mapSubito, subitoId } from '../src/providers/subito.js';

const NOW = '2026-09-14T10:00:00.000Z';

describe('Süd-/Osteuropa: Länderzuordnung', () => {
  it('ordnet Verkäuferländer den Märkten zu', () => {
    assert.equal(marketForCountry('IT'), 'SE');
    assert.equal(marketForCountry('pt'), 'SE');
    assert.equal(marketForCountry('PL'), 'EE');
    assert.equal(marketForCountry('cz'), 'EE');
    assert.equal(marketForCountry('DE'), null);
    assert.equal(marketForCountry(undefined), null);
  });
});

describe('OLX mapping (olx.pl)', () => {
  const site = { country: 'pl', host: 'www.olx.pl', categoryId: 84, currency: 'PLN', enabled: true };
  const offer = {
    id: 912345678, url: 'https://www.olx.pl/d/oferta/bmw-520d-xdrive-CID5-ID1abc.html', title: 'BMW 520d xDrive Luxury Line, salon PL', created_time: '2026-09-13T08:00:00+02:00', business: true, status: 'active',
    params: [
      { key: 'price', name: 'Cena', type: 'price', value: { value: 119900, currency: 'PLN', negotiable: false, label: '119 900 zł' } },
      { key: 'model', name: 'Model', type: 'select', value: { key: 'seria-5', label: 'Seria 5' } },
      { key: 'year', name: 'Rok produkcji', type: 'input', value: { key: '2019', label: '2019' } },
      { key: 'milage', name: 'Przebieg', type: 'input', value: { key: '98000', label: '98 000 km' } },
      { key: 'petrol', name: 'Paliwo', type: 'select', value: { key: 'diesel', label: 'Diesel' } },
      { key: 'transmission', name: 'Skrzynia biegów', type: 'select', value: { key: 'automatic', label: 'Automatyczna' } },
      { key: 'enginesize', name: 'Poj. silnika', type: 'input', value: { key: '1995', label: '1 995 cm³' } },
      { key: 'car_body', name: 'Typ nadwozia', type: 'select', value: { key: 'sedan', label: 'Sedan' } },
      { key: 'condition', name: 'Stan techniczny', type: 'select', value: { key: 'notdamaged', label: 'Nieuszkodzony' } },
    ],
    location: { city: { name: 'Warszawa' }, region: { name: 'Mazowieckie' } },
    photos: [{ link: 'https://ireland.apollo.olxcdn.com/v1/files/abc/image;s={width}x{height}', width: 1200, height: 900 }],
    category: { id: 183, type: 'goods' },
  };

  it('bildet ein polnisches Angebot als Festpreis in PLN im Markt Osteuropa ab', () => {
    const l = mapOlxOffer(offer, site, NOW, new Map([[183, 'BMW']]));
    assert.ok(l);
    assert.equal(l.id, 'olx-pl:912345678');
    assert.equal(l.source, 'olx-pl');
    assert.equal(l.market, 'EE');
    assert.equal(l.country, 'pl');
    assert.equal(l.make, 'BMW');
    assert.equal(l.model, 'Seria 5');
    assert.equal(l.year, 2019);
    assert.equal(l.km, 98000);
    assert.equal(l.price, 119900);
    assert.equal(l.currency, 'PLN');
    assert.equal(l.fuel, 'Diesel');
    assert.equal(l.transmission, 'Automatic');
    assert.equal(l.engineCcm, 1995);
    assert.equal(l.engine, '2.0 L');
    assert.equal(l.drive, 'AWD');
    assert.equal(l.location, 'Warszawa');
    assert.equal(l.coc, true);
    assert.equal(l.partnerId, 'carpathia');
    assert.equal(l.photos[0], 'https://ireland.apollo.olxcdn.com/v1/files/abc/image;s=1280x960');
    assert.match(l.trim, /xDrive Luxury Line/);
  });

  it('Marke aus dem Titel, wenn Kategorie unbekannt; beschädigte und inaktive Angebote fallen weg', () => {
    const l = mapOlxOffer({ ...offer, category: { id: 999 } }, site, NOW);
    assert.equal(l?.make, 'BMW');
    assert.equal(makeFromTitle('Alfa Romeo Giulia Veloce'), 'Alfa Romeo');
    assert.equal(makeFromTitle('Skoda Octavia'), 'Škoda');
    assert.equal(makeFromTitle('VW Golf'), 'Volkswagen');
    const damaged = { ...offer, params: offer.params.map((p) => (p.key === 'condition' ? { ...p, value: { key: 'damaged', label: 'Uszkodzony' } } : p)) };
    assert.equal(mapOlxOffer(damaged, site, NOW), null);
    assert.equal(mapOlxOffer({ ...offer, status: 'removed_by_user' }, site, NOW), null);
    assert.equal(olxPhoto(undefined), null);
  });

  it('portugiesische Seite → Südeuropa, EUR', () => {
    const l = mapOlxOffer({ ...offer, params: offer.params.map((p) => (p.key === 'price' ? { ...p, value: { value: 21500, currency: 'EUR' } } : p)) }, { country: 'pt', host: 'www.olx.pt', categoryId: 1, currency: 'EUR', enabled: true }, NOW, new Map([[183, 'BMW']]));
    assert.equal(l?.market, 'SE');
    assert.equal(l?.currency, 'EUR');
    assert.equal(l?.partnerId, 'adriatica');
  });
});

describe('Subito.it mapping', () => {
  const ad = {
    urn: 'id:ad:24680:list:612345678', subject: 'Alfa Romeo Giulia 2.2 Turbodiesel 210 CV AT8 Veloce Q4', body: '…',
    type: { key: 's', value: 'Vendita' }, category: { key: '2', value: 'Auto' },
    dates: { display: '2026-09-13T09:12:00+0200' },
    features: {
      '/price': { uri: '/price', label: 'Prezzo', values: [{ key: '32900', value: '32.900 €' }] },
      '/register_date': { uri: '/register_date', values: [{ key: '2021', value: '2021' }] },
      '/mileage_scalar': { uri: '/mileage_scalar', values: [{ key: '61000', value: '61000' }] },
      '/car_brand': { uri: '/car_brand', values: [{ key: '3', value: 'Alfa Romeo' }] },
      '/car_model': { uri: '/car_model', values: [{ key: '12', value: 'Giulia' }] },
      '/car_version': { uri: '/car_version', values: [{ key: 'x', value: '2.2 Turbodiesel 210 CV AT8 Veloce Q4' }] },
      '/fuel': { uri: '/fuel', values: [{ key: '2', value: 'Diesel' }] },
      '/gearbox': { uri: '/gearbox', values: [{ key: '2', value: 'Automatico' }] },
      '/cubic_capacity': { uri: '/cubic_capacity', values: [{ key: '2143', value: '2143' }] },
    },
    geo: { region: { value: 'Lombardia' }, city: { value: 'Milano', short_name: 'MI' }, town: { value: 'Sesto San Giovanni' } },
    images: [{ cdn_base_url: 'https://images.sbito.it/api/v1/sbt-ads-images-pro/images/aa/aa1' }],
    urls: { default: 'https://www.subito.it/auto/alfa-romeo-giulia-milano-612345678.htm' },
  };

  it('bildet ein italienisches Inserat als Festpreis in EUR im Markt Südeuropa ab', () => {
    const l = mapSubito(ad, NOW);
    assert.ok(l);
    assert.equal(l.id, 'subito:612345678');
    assert.equal(l.market, 'SE');
    assert.equal(l.country, 'it');
    assert.equal(l.make, 'Alfa Romeo');
    assert.equal(l.model, 'Giulia');
    assert.equal(l.year, 2021);
    assert.equal(l.km, 61000);
    assert.equal(l.price, 32900);
    assert.equal(l.fuel, 'Diesel');
    assert.equal(l.transmission, 'Automatic');
    assert.equal(l.engineCcm, 2143);
    assert.equal(l.drive, 'AWD');
    assert.equal(l.location, 'Sesto San Giovanni');
    assert.equal(l.photos[0], 'https://images.sbito.it/api/v1/sbt-ads-images-pro/images/aa/aa1?rule=gallery-desktop-2x-jpeg');
    assert.equal(l.url, 'https://www.subito.it/auto/alfa-romeo-giulia-milano-612345678.htm');
    assert.equal(l.partnerId, 'adriatica');
  });

  it('Gesuche und Inserate ohne Preis/Baujahr fallen weg', () => {
    assert.equal(mapSubito({ ...ad, type: { key: 'k', value: 'Cerco' } }, NOW), null);
    assert.equal(mapSubito({ ...ad, features: { ...ad.features, '/price': { values: [] } } }, NOW), null);
    assert.equal(subitoId('id:ad:24680:list:612345678'), '612345678');
  });
});

describe('Sauto.cz mapping', () => {
  const item = {
    id: 214567890, name: 'Škoda Octavia 2.0 TDI Style DSG', price: 489000, seo_name: 'skoda-octavia-2-0-tdi',
    manufacturer_cb: { id: 93, name: 'Škoda', seo_name: 'skoda' }, model_cb: { id: 707, name: 'Octavia', seo_name: 'octavia' },
    tachometer: 74500, manufacturing_date: '2020-03-01T00:00:00Z', engine_volume: 1968, engine_power: 110,
    fuel_cb: { name: 'Nafta' }, gearbox_cb: { name: 'Automatická' }, drive_cb: { name: 'Přední' }, condition_cb: { name: 'Ojeté' },
    locality: { municipality: 'Brno', district: 'Brno-město', region: 'Jihomoravský kraj' },
    images: [{ url: '//d15-a.sdn.cz/d_15/c_img_QK_Iw/abc123.jpeg' }, { url: 'https://d15-a.sdn.cz/d_15/c_img_QK_Iw/def456.jpeg?fl=exf|res,400,300,1' }],
    premise: { name: 'AutoHaus Brno' },
  };

  it('bildet ein tschechisches Inserat als Festpreis in CZK im Markt Osteuropa ab', () => {
    const l = mapSauto(item, NOW);
    assert.ok(l);
    assert.equal(l.id, 'sauto:214567890');
    assert.equal(l.market, 'EE');
    assert.equal(l.country, 'cz');
    assert.equal(l.make, 'Škoda');
    assert.equal(l.model, 'Octavia');
    assert.equal(l.trim, '2.0 TDI Style DSG');
    assert.equal(l.year, 2020);
    assert.equal(l.km, 74500);
    assert.equal(l.price, 489000);
    assert.equal(l.currency, 'CZK');
    assert.equal(l.fuel, 'Diesel');
    assert.equal(l.transmission, 'Automatic');
    assert.equal(l.drive, 'FWD');
    assert.equal(l.engineCcm, 1968);
    assert.equal(l.location, 'Brno');
    assert.equal(l.url, 'https://www.sauto.cz/osobni/detail/skoda/octavia/214567890');
    assert.equal(l.photos[0], 'https://d15-a.sdn.cz/d_15/c_img_QK_Iw/abc123.jpeg?fl=exf|res,1024,768,1|jpg,85');
    assert.equal(l.photos[1], 'https://d15-a.sdn.cz/d_15/c_img_QK_Iw/def456.jpeg?fl=exf|res,400,300,1');
    assert.equal(l.partnerId, 'carpathia');
  });

  it('Baujahr aus Datum oder Zahl, Bild-URL tolerant', () => {
    assert.equal(sautoYear('2018-06-01'), 2018);
    assert.equal(sautoYear(2016), 2016);
    assert.equal(sautoYear(undefined), null);
    assert.equal(sautoImage(undefined), null);
    assert.equal(mapSauto({ ...item, manufacturing_date: undefined, in_operation_date: 2017 }, NOW)?.year, 2017);
    assert.equal(mapSauto({ ...item, price: 0 }, NOW), null);
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
