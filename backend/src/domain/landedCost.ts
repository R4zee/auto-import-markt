import { DESTINATIONS, FEES, MARKETS } from './markets.js';
import type { CostLine, DestCode, LandedCost, MarketCode } from './types.js';

export interface LandedCostParams {
  market: MarketCode;
  price: number;
  currency: string;
  classic?: boolean;
  dutyRateOverride?: number | null;
  originProof?: boolean;
  dest: DestCode;
  /** EUR je Einheit Fremdwährung */
  fxRate: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Endpreis-Kalkulation ("landed cost") für einen Privatimport ins Zielland.
 * Reihenfolge wie im Design: FOB → Fracht+Versicherung → CIF → Zoll → EUSt →
 * Zollabwicklung → TÜV/HU → Zulassung → Partnergebühr.
 */
export function calcLandedCost(p: LandedCostParams): LandedCost {
  const market = MARKETS[p.market];
  const dest = DESTINATIONS[p.dest];
  const isEU = market.isEU;
  const classic = p.classic === true;

  const fob = p.price * p.fxRate;
  const freight = market.freightEur;
  const insurance = fob * (isEU ? FEES.insurancePctEU : FEES.insurancePct);
  const cif = fob + freight + insurance;

  let dutyRate: number;
  if (isEU || classic) dutyRate = 0;
  else if (p.dutyRateOverride != null) dutyRate = p.dutyRateOverride;
  else if (p.originProof && market.preferentialDutyRate != null) dutyRate = market.preferentialDutyRate;
  else dutyRate = market.dutyRate;

  const duty = cif * dutyRate;
  const vatRate = isEU ? 0 : classic ? dest.classicVatRate : dest.vatRate;
  const vat = (cif + duty) * vatRate;
  const clearing = isEU ? 0 : FEES.clearingNonEU;
  const inspection = isEU ? FEES.inspectionEU : FEES.inspectionNonEU;
  const registration = FEES.registration;
  const partnerFee = isEU ? FEES.partnerFeeEU : FEES.partnerFeeNonEU;
  const total = cif + duty + vat + clearing + inspection + registration + partnerFee;

  const lines: CostLine[] = [
    { key: 'lFob', amountEur: round2(fob) },
    // EU: Straßentransport statt Seefracht (eigene Bezeichnung)
    { key: isEU ? 'lFreightEU' : 'lFreight', amountEur: round2(freight + insurance) },
    { key: 'lCif', amountEur: round2(cif) },
  ];
  if (isEU) {
    lines.push({ key: 'lDutyEU', amountEur: null });
    lines.push({ key: 'lVatEU', amountEur: null });
  } else {
    lines.push({ key: 'lDuty', vars: { r: Math.round(dutyRate * 100) }, amountEur: duty > 0 ? round2(duty) : null });
    lines.push({ key: 'lTax', vars: { r: Math.round(vatRate * 100) }, amountEur: round2(vat) });
    lines.push({ key: 'lClearing', amountEur: clearing });
  }
  lines.push({ key: isEU ? 'lHu' : 'lTuv', amountEur: inspection });
  lines.push({ key: 'lReg', amountEur: registration });
  lines.push({ key: 'lFee', amountEur: partnerFee });

  let noteKey: string;
  const noteVars: Record<string, string | number> = {};
  if (isEU) noteKey = 'nEU';
  else if (classic) noteKey = 'nClassic';
  else if (dutyRate === FEES.lcvDutyRate) noteKey = 'nLcv';
  else if (dutyRate === 0) { noteKey = 'nPref'; noteVars.r = Math.round(vatRate * 100); }
  else { noteKey = 'nStd'; noteVars.r = Math.round(vatRate * 100); }

  return {
    dest: p.dest,
    fxRate: p.fxRate,
    fobEur: round2(fob),
    freightEur: freight,
    insuranceEur: round2(insurance),
    cifEur: round2(cif),
    dutyRate,
    dutyEur: round2(duty),
    vatRate,
    vatEur: round2(vat),
    clearingEur: clearing,
    inspectionEur: inspection,
    registrationEur: registration,
    partnerFeeEur: partnerFee,
    totalEur: round2(total),
    lines,
    noteKey,
    noteVars,
    isEU,
  };
}
