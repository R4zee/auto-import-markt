import type { Fuel, VehicleTax } from './types.ts';

/**
 * Deutsche Kfz-Steuer nach § 9 KraftStG für Pkw.
 * Maßgeblich ist das Datum der (weltweiten) Erstzulassung. Bei Importen ohne
 * WLTP-Wert setzt das Hauptzollamt den CO2-Wert nach Abgasgutachten fest –
 * das Ergebnis ist daher als Schätzung gekennzeichnet.
 */
export function calcGermanVehicleTax(input: {
  fuel: Fuel;
  engineCcm: number | null;
  co2Gkm: number | null;
  firstRegistration: string; // ISO-Datum
}): VehicleTax | null {
  const { fuel, engineCcm, co2Gkm } = input;
  const reg = new Date(input.firstRegistration);
  if (Number.isNaN(reg.getTime())) return null;

  if (fuel === 'Electric') {
    // Befreiung für Erstzulassungen bis 31.12.2025, längstens bis 31.12.2030
    if (reg <= new Date('2025-12-31')) {
      return { annualEur: 0, method: 'Elektro – befreit bis 31.12.2030 (§ 3d KraftStG)', estimated: false };
    }
    return { annualEur: 0, method: 'Elektro – Gewichtsbesteuerung ab 2031, aktuell 0 €', estimated: true };
  }

  if (!engineCcm) return null;
  const ccmUnits = Math.ceil(engineCcm / 100);
  const isDiesel = fuel === 'Diesel';

  // Hubraumkomponente
  const baseRate = isDiesel ? 9.5 : 2.0;
  const base = ccmUnits * baseRate;

  const co2 = co2Gkm ?? estimateCo2(fuel, engineCcm);
  const estimated = co2Gkm == null;

  let co2Part = 0;
  let method: string;
  if (reg >= new Date('2021-01-01')) {
    // Gestaffelter CO2-Tarif
    const bands: Array<[number, number, number]> = [
      [96, 115, 2.0], [116, 135, 2.2], [136, 155, 2.5], [156, 175, 2.9], [176, 195, 3.4], [196, Infinity, 4.0],
    ];
    for (const [from, to, rate] of bands) {
      if (co2 < from) break;
      const upper = Math.min(co2, to);
      co2Part += (upper - from + 1) * rate;
    }
    method = 'EZ ab 2021: Hubraum + gestaffelter CO2-Tarif (WLTP)';
  } else if (reg >= new Date('2009-07-01')) {
    const free = reg >= new Date('2014-01-01') ? 95 : reg >= new Date('2012-01-01') ? 110 : 120;
    co2Part = Math.max(0, co2 - free) * 2.0;
    method = `EZ 07/2009–12/2020: Hubraum + 2 €/g CO2 über ${free} g`;
  } else {
    // Vor 07/2009: Schadstoffklasse; hier Euro 3/4 angenommen (häufigster Fall) – Schätzung
    const rate = isDiesel ? 15.44 : 6.75;
    return {
      annualEur: Math.round(ccmUnits * rate),
      method: 'EZ vor 07/2009: Hubraum × Satz Schadstoffklasse (Euro 3/4 angenommen)',
      estimated: true,
    };
  }

  return { annualEur: Math.round(base + co2Part), method, estimated };
}

/** Grobe CO2-Schätzung, falls kein WLTP-Wert vorliegt (nur für Anzeige). */
function estimateCo2(fuel: Fuel, ccm: number): number {
  const perLitre = fuel === 'Diesel' ? 52 : fuel === 'Hybrid' ? 30 : 60;
  return Math.round((ccm / 1000) * perLitre + 45);
}
