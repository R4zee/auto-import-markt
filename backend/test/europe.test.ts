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
  // Struktur der Live-Antwort vom 14.09.2026 (features als Array, Marke/Modell/Version im Paket "/car")
  const ad = {
    urn: 'id:ad:64c6f980-6724-4df7-81da-048be829d961:list:660706120', subject: 'Captur 1000 GPL giugno 22', body: '…',
    type: { key: 's', value: 'In vendita' }, category: { key: '2', value: 'Auto', friendly_name: 'auto' },
    dates: { display: '2026-09-14 16:47:45', display_iso8601: '2026-09-14T16:47:45.285+0200' },
    features: [
      { type: 'list', uri: '/car_type', label: 'Carrozzeria', values: [{ key: '3', value: 'Station Wagon' }] },
      { type: 'list', uri: '/gearbox', label: 'Cambio', values: [{ key: '1', value: 'Manuale' }] },
      { type: 'number', uri: '/price', label: 'Prezzo', values: [{ key: '13400', value: '13400 €' }] },
      { type: 'list', uri: '/fuel', label: 'Carburante', values: [{ key: '3', value: 'Gpl' }] },
      { type: 'pack', uri: '/car', label: 'Auto', values: [
        { key: '000062', value: 'RENAULT', level: 0, label: 'Marca' },
        { key: '004665', value: 'Captur 2ª serie', group_key: '001565', group_label: 'Captur', level: 1, label: 'Modello' },
        { key: '139443', value: 'Captur TCe 100 CV GPL FAP Intens', level: 2, label: 'Versione' },
      ] },
      { type: 'list', uri: '/mileage', label: 'Km', values: [{ key: '19', value: '90.000 - 94.999' }] },
      { type: 'number', uri: '/mileage_scalar', label: 'Km', values: [{ key: '90500', value: '90500 Km' }] },
      { type: 'string', uri: '/power', label: 'Potenza', values: [{ key: '74/101', value: '74 kW / 101 Cv' }] },
      { type: 'list', uri: '/year', label: 'Anno di immatricolazione', values: [{ key: '2022', value: '2022' }] },
      { type: 'string', uri: '/register_date', label: 'Immatricolazione', values: [{ key: '06/2022', value: '06/2022' }] },
    ],
    geo: { region: { value: 'Toscana' }, city: { value: 'Firenze', short_name: 'FI' }, town: { value: 'Firenze' } },
    images: [{ uri: 'imgid:3f', base_url: 'https://s.sbito.it/img/3f/3f3d', cdn_base_url: 'https://images.sbito.it/api/v1/sbt-ads-images-pro/images/3f/3f3d' }],
    urls: { default: 'https://www.subito.it/auto/captur-1000-gpl-giugno-22-firenze-660706120.htm' },
    advertiser: { user_id: '144784051', name: '', company: false, type: 0 },
  };

  it('bildet ein italienisches Inserat als Festpreis in EUR im Markt Südeuropa ab', () => {
    const l = mapSubito(ad, NOW);
    assert.ok(l);
    assert.equal(l.id, 'subito:660706120');
    assert.equal(l.market, 'SE');
    assert.equal(l.country, 'it');
    assert.equal(l.make, 'Renault');
    assert.equal(l.model, 'Captur');
    assert.match(l.trim, /^Captur TCe 100 CV GPL FAP Intens · Station Wagon/);
    assert.equal(l.year, 2022);
    assert.equal(l.km, 90500);
    assert.equal(l.price, 13400);
    assert.equal(l.currency, 'EUR');
    assert.equal(l.fuel, 'Petrol');
    assert.equal(l.transmission, 'Manual');
    assert.equal(l.engineCcm, null);
    assert.equal(l.location, 'Firenze');
    assert.equal(l.photos[0], 'https://images.sbito.it/api/v1/sbt-ads-images-pro/images/3f/3f3d?rule=gallery-desktop-2x-jpeg');
    assert.equal(l.url, 'https://www.subito.it/auto/captur-1000-gpl-giugno-22-firenze-660706120.htm');
    assert.equal(l.partnerId, 'adriatica');
  });

  it('Jahr aus register_date "06/2022" ohne /year; Kurzmarken bleiben groß', () => {
    const noYear = { ...ad, features: ad.features.filter((f) => f.uri !== '/year') };
    assert.equal(mapSubito(noYear, NOW)?.year, 2022);
    const bmw = { ...ad, features: ad.features.map((f) => (f.uri === '/car' ? { ...f, values: [{ key: '1', value: 'BMW', level: 0 }, { key: '2', value: 'Serie 3 (G20)', level: 1 }, { key: '3', value: '320d xDrive', level: 2 }] } : f)) };
    const l = mapSubito(bmw, NOW);
    assert.equal(l?.make, 'BMW');
    assert.equal(l?.model, 'Serie 3 (G20)');
    assert.equal(l?.drive, 'AWD');
  });

  it('Rückfall auf den Beschreibungstext, wenn Features fehlen', () => {
    const bodyOnly = {
      urn: 'id:ad:34a42066:list:660705243', subject: 'Audi Q2 1.6 TDI Design Unico proprietario', type: { key: 's', value: 'In vendita' }, category: { key: '2', value: 'Auto' },
      body: 'Audi Q2 1.6 TDI Design Diesel, manuale. …\nImmatricolazione: 10/2017, Chilometraggio: 169.000 km\nMotore e trasmissione: Diesel, manuale, 1598 cc, 85 kW/115 PS\nPrezzo: 15.900 €',
      images: [{ base_url: 'https://s.sbito.it/img/3f/3f3d', cdn_base_url: 'https://images.sbito.it/api/v1/sbt-ads-images-pro/images/3f/3f3d' }],
      urls: { default: 'https://www.subito.it/auto/audi-q2-660705243.htm' },
    };
    const l = mapSubito(bodyOnly, NOW);
    assert.ok(l);
    assert.equal(l.id, 'subito:660705243');
    assert.equal(l.make, 'Audi');
    assert.equal(l.model, 'Q2');
    assert.equal(l.year, 2017);
    assert.equal(l.km, 169000);
    assert.equal(l.engineCcm, 1598);
    assert.equal(l.price, 15900);
    assert.equal(l.fuel, 'Diesel');
    assert.equal(l.transmission, 'Manual');
  });

  it('Gesuche und Inserate ohne Preis/Baujahr fallen weg', () => {
    assert.equal(mapSubito({ ...ad, type: { key: 'k', value: 'Cerco' } }, NOW), null);
    assert.equal(mapSubito({ ...ad, features: ad.features.filter((f) => f.uri !== '/price') }, NOW), null);
    assert.equal(subitoId('id:ad:64c6f980-6724-4df7-81da-048be829d961:list:660706120'), '660706120');
  });
});

describe('Sauto.cz mapping', () => {
  // Struktur wie in der Live-Antwort vom 14.09.2026 (Trefferliste ohne engine_volume, Ausstattung in additional_model_name)
  const item = {
    id: 214567890, name: 'Škoda Octavia, 2.0 TDI Style DSG', additional_model_name: '2.0 TDI Style DSG', price: 489000, seo_name: 'skoda-octavia-2-0-tdi', deal_type: 'sale',
    manufacturer_cb: { value: 93, name: 'Škoda', seo_name: 'skoda' }, model_cb: { value: 707, name: 'Octavia', seo_name: 'octavia' },
    tachometer: 74500, manufacturing_date: '2020-01-01', in_operation_date: '2020-03-18', images_total_count: 41,
    fuel_cb: { name: 'Nafta', seo_name: 'nafta', value: 2 }, gearbox_cb: { name: 'Automatická', seo_name: 'automaticka', value: 3 }, drive_cb: { name: 'Přední' },
    locality: { municipality: '', district: 'Brno-město', region: 'Jihomoravský kraj', municipality_seo_name: '', district_seo_name: 'brno-mesto' },
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
    assert.equal(l.engineCcm, null);
    assert.equal(l.engine, '2.0 L');
    assert.equal(l.photoCount, 41);
    assert.equal(l.location, 'Brno-město');
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
    assert.equal(mapSauto({ ...item, deal_type: 'lease' }, NOW), null);
    const withCcm = mapSauto({ ...item, engine_volume: 1968, additional_model_name: '' }, NOW);
    assert.equal(withCcm?.engineCcm, 1968);
    assert.equal(withCcm?.engine, '2.0 L');
    assert.equal(mapSauto({ ...item, additional_model_name: '', name: 'Škoda Octavia, 1,2 TSi DSG' }, NOW)?.trim, '1,2 TSi DSG');
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
