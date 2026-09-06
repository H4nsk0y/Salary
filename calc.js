// ==========================
// FILE: /calc.js
// ==========================
export const BONUS_RATE = 0.35;
export const TAX_RATE = 0.13;
export const NIGHT_EXTRA_RATE = 0.4;

export function computePaymentSplit({
  netTotal,
  effectiveOklad,
  monthNorm,
  firstHalfDayHours,
  firstHalfNightHours,
} = {}) {
  const values = [netTotal, effectiveOklad, monthNorm, firstHalfDayHours, firstHalfNightHours];
  if (!values.every(Number.isFinite) || monthNorm <= 0) {
    return { advance: 0, remaining: Number.isFinite(netTotal) ? netTotal : 0 };
  }

  const firstHalfTotal = firstHalfDayHours + firstHalfNightHours;
  const baseNetHourlyNoBonus = (effectiveOklad * (1 - TAX_RATE)) / monthNorm;
  const nightExtraNetHourly = (effectiveOklad / monthNorm) * NIGHT_EXTRA_RATE * (1 - TAX_RATE);
  const advance = baseNetHourlyNoBonus * firstHalfTotal + nightExtraNetHourly * firstHalfNightHours;

  // Bonuses and the additional x2 part for holidays are settled with the final payment.
  return {
    advance,
    remaining: netTotal - advance,
  };
}

/**
 * @param {unknown} input
 * @returns {number}
 */
export function parseNumber(input) {
  if (input == null) return 0;
  const s = String(input).trim().replace(/\s+/g, "").replace(",", ".");
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}


export function computeSalary(input) {
  if (!input || typeof input !== "object") return { ok: false, error: "Не заданы данные расчета." };
  const { oklad, normHours, workedHours, nightHours } = input;

  if (![oklad, normHours, workedHours, nightHours].every(Number.isFinite)) {
    return { ok: false, error: "Оклад и часы должны быть конечными числами." };
  }

  if (!(oklad >= 0)) return { ok: false, error: "Оклад должен быть числом ≥ 0." };
  if (!(normHours > 0)) return { ok: false, error: "Норма часов должна быть числом > 0." };
  if (!(workedHours >= 0)) return { ok: false, error: "Отработанные часы должны быть числом ≥ 0." };
  if (!(nightHours >= 0)) return { ok: false, error: "Ночные часы должны быть числом ≥ 0." };
  if (nightHours > workedHours) {
    return { ok: false, error: "Ночные часы не могут быть больше отработанных часов." };
  }

  const baseHourRateGross = oklad / normHours;
  const ratio = workedHours / normHours;

  const baseFact = baseHourRateGross * workedHours; 
  const bonus = oklad * BONUS_RATE * ratio; 
  const nightExtra = baseHourRateGross * nightHours * NIGHT_EXTRA_RATE;

  const gross = baseFact + bonus + nightExtra;
  const tax = gross * TAX_RATE;
  const net = gross - tax;

  const hourRate = (oklad * (1 + BONUS_RATE) * (1 - TAX_RATE)) / normHours; 

  return {
    ok: true,
    result: { hourRate, baseFact, nightExtra, bonus, gross, tax, net },
  };
}
