import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calcLandedCost } from '../src/domain/landedCost.js';
import { calcGermanVehicleTax } from '../src/domain/vehicleTax.js';

describe('calcLandedCost', () => {
  it('rechnet einen Japan-Import wie im Design (10 % Zoll, 19 % EUSt)', () => {
    const r = calcLandedCost({ market: 'JP', dest: 'DE', price: 5_480_000, currency: 'JPY', fxRate: 0.0061 });
    const fob = 5_480_000 * 0.0061;
    const cif = fob + 1850 + fob * 0.011;
    const duty = cif * 0.1;
    const vat = (cif + duty) * 0.19;
    const expected = cif + duty + vat + 240 + 780 + 98 + 950;
    assert.equal(r.dutyRate, 0.1);
    assert.equal(r.vatRate, 0.19);
    assert.ok(Math.abs(r.totalEur - expected) < 0.01);
    assert.equal(r.noteKey, 'nStd');
    assert.equal(r.lines.length, 9);
  });

  it('EU-Ware: kein Zoll, keine EUSt, HU statt §21', () => {
    const r = calcLandedCost({ market: 'EE', dest: 'DE', price: 67_200, currency: 'EUR', fxRate: 1 });
    assert.equal(r.dutyEur, 0);
    assert.equal(r.vatEur, 0);
    assert.equal(r.clearingEur, 0);
    assert.equal(r.inspectionEur, 145);
    assert.equal(r.partnerFeeEur, 450);
    assert.equal(r.noteKey, 'nEU');
    assert.ok(r.lines.some((l) => l.key === 'lHu'));
  });

  it('Sammlerfahrzeug: 0 % Zoll, 7 % EUSt', () => {
    const r = calcLandedCost({ market: 'US', dest: 'DE', price: 27_900, currency: 'USD', fxRate: 0.92, classic: true });
    assert.equal(r.dutyRate, 0);
    assert.equal(r.vatRate, 0.07);
    assert.equal(r.noteKey, 'nClassic');
  });

  it('Nutzfahrzeug-Override 22 %', () => {
    const r = calcLandedCost({ market: 'US', dest: 'DE', price: 62_400, currency: 'USD', fxRate: 0.92, dutyRateOverride: 0.22 });
    assert.equal(r.dutyRate, 0.22);
    assert.equal(r.noteKey, 'nLcv');
  });

  it('Präferenzursprung Japan → 0 % Zoll', () => {
    const r = calcLandedCost({ market: 'JP', dest: 'DE', price: 1_000_000, currency: 'JPY', fxRate: 0.0061, originProof: true });
    assert.equal(r.dutyRate, 0);
    assert.equal(r.noteKey, 'nPref');
  });

  it('Zielland bestimmt den Steuersatz', () => {
    const pl = calcLandedCost({ market: 'US', dest: 'PL', price: 10_000, currency: 'USD', fxRate: 1 });
    assert.equal(pl.vatRate, 0.23);
  });
});

describe('calcGermanVehicleTax', () => {
  it('EZ 2023, Benziner 3956 ccm, 276 g CO2', () => {
    const t = calcGermanVehicleTax({ fuel: 'Petrol', engineCcm: 3956, co2Gkm: 276, firstRegistration: '2023-07-01' });
    assert.ok(t);
    // Hubraum: 40 × 2 = 80; CO2: 20×2 + 20×2.2 + 20×2.5 + 20×2.9 + 20×3.4 + 81×4 = 584 → 664
    assert.equal(t.annualEur, 664);
    assert.equal(t.estimated, false);
  });

  it('EZ 2019, Diesel 2755 ccm, 209 g', () => {
    const t = calcGermanVehicleTax({ fuel: 'Diesel', engineCcm: 2755, co2Gkm: 209, firstRegistration: '2019-07-01' });
    assert.ok(t);
    // 28 × 9.5 = 266; (209 − 95) × 2 = 228 → 494
    assert.equal(t.annualEur, 494);
  });

  it('Elektro befreit', () => {
    const t = calcGermanVehicleTax({ fuel: 'Electric', engineCcm: null, co2Gkm: 0, firstRegistration: '2023-01-01' });
    assert.equal(t?.annualEur, 0);
  });

  it('ohne CO2-Wert → Schätzung', () => {
    const t = calcGermanVehicleTax({ fuel: 'Petrol', engineCcm: 2960, co2Gkm: null, firstRegistration: '1990-05-01' });
    assert.ok(t);
    assert.equal(t.estimated, true);
  });
});
