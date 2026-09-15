import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canonicalMake, makeKey } from '../src/domain/makes.js';
import { makeFromTitle } from '../src/providers/olx.js';

describe('Markennormalisierung', () => {
  it('führt Schreibvarianten derselben Marke zusammen', () => {
    for (const v of ['Mercedes', 'MERCEDES-BENZ', 'Mercedes Benz', 'mercedes-benz', 'Mercedes-AMG', 'Мерцедес']) assert.equal(canonicalMake(v), 'Mercedes-Benz', v);
    for (const v of ['VW', 'volkswagen', 'VOLKSWAGEN']) assert.equal(canonicalMake(v), 'Volkswagen', v);
    for (const v of ['Land Rover', 'LAND ROVER', 'Landrover', 'Land-Rover', 'Range Rover']) assert.equal(canonicalMake(v), 'Land Rover', v);
    for (const v of ['Skoda', 'ŠKODA', 'škoda']) assert.equal(canonicalMake(v), 'Škoda', v);
    for (const v of ['Citroen', 'CITROËN', 'Citroën']) assert.equal(canonicalMake(v), 'Citroën', v);
    for (const v of ['Alfa Romeo', 'ALFA ROMEO', 'Alfa-Romeo', 'Alfa']) assert.equal(canonicalMake(v), 'Alfa Romeo', v);
    for (const v of ['mini', 'Mini', 'MINI']) assert.equal(canonicalMake(v), 'MINI', v);
    for (const v of ['Bmw', 'BMW', 'bmw']) assert.equal(canonicalMake(v), 'BMW', v);
    for (const v of ['KIA', 'kia']) assert.equal(canonicalMake(v), 'Kia', v);
    for (const v of ['Seat', 'SEAT']) assert.equal(canonicalMake(v), 'SEAT', v);
    for (const v of ['Chevrolet (GM Daewoo)', 'Chevy', 'CHEVROLET']) assert.equal(canonicalMake(v), 'Chevrolet', v);
    for (const v of ['Renault Samsung', 'Renault Korea (Samsung)']) assert.equal(canonicalMake(v), 'Renault Korea', v);
    assert.equal(canonicalMake('Rolls Royce'), 'Rolls-Royce');
    assert.equal(canonicalMake('Ssangyong'), 'SsangYong');
    assert.equal(canonicalMake('KG Mobility'), 'KG Mobility');
  });

  it('vereinheitlicht unbekannte Marken nur in der Schreibweise', () => {
    assert.equal(canonicalMake('HONGQI'), 'Hongqi');
    assert.equal(canonicalMake('great wall motors'), 'Great Wall Motors');
    assert.equal(canonicalMake('Renault'), 'Renault');
    assert.equal(canonicalMake('  Toyota  '), 'Toyota');
    assert.equal(canonicalMake('ZX'), 'ZX', 'kurze Großbuchstaben-Kürzel bleiben');
    assert.equal(canonicalMake('Voyah (Dongfeng)'), 'Voyah');
    assert.equal(canonicalMake(''), '');
    assert.equal(canonicalMake(null), '');
  });

  it('Vergleichsschlüssel ignoriert Groß-/Kleinschreibung, Akzente und Trennzeichen', () => {
    assert.equal(makeKey('Mercedes-Benz'), 'mercedesbenz');
    assert.equal(makeKey('Škoda'), 'skoda');
    assert.equal(makeKey('Lynk & Co'), 'lynkco');
    assert.equal(makeKey('Хюндай'), makeKey('хюндаи'));
  });

  it('Marke aus dem Titel kommt bereits kanonisch zurück', () => {
    assert.equal(makeFromTitle('Sprzedam VW Golf 7 2015'), 'Volkswagen');
    assert.equal(makeFromTitle('Mercedes E220 CDI'), 'Mercedes-Benz');
    assert.equal(makeFromTitle('Продавам Мерцедес Е220'), 'Mercedes-Benz');
    assert.equal(makeFromTitle('Range Rover Evoque 2.0 TD4'), 'Land Rover');
    assert.equal(makeFromTitle('Skoda Octavia III'), 'Škoda');
    assert.equal(makeFromTitle('HONGQI E-HS9'), 'Hongqi');
  });
});
