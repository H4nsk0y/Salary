// ==========================
// FILE: /calc.js
// ==========================
export const BONUS_RATE = 0.35;
export const TAX_RATE = 0.13;
export const NIGHT_EXTRA_RATE = 0.4;

/**
 * Parses input like "50 000", "50000", "50,5".
 * @param {unknown} input
 * @returns {number} Finite number or NaN
 */
export function parseNumber(input) {
  if (input == null) return 0;
  const s = String(input).trim().replace(/\s+/g, "").replace(",", ".");
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * Логика:
 * - Премия всегда от оклада, но пропорциональна worked/norm.
 * - Ночные: +40% от базовой ставки (oklad/norm) на nightHours.
 * - Налог 13% от (база + премия + ночные).
 * - hourRate (для UI) = НЕТТО ставка с премией и вычетом:
 *   (oklad * 1.35 * 0.87) / normHours
 */
export function computeSalary(input) {
  const { oklad, normHours, workedHours, nightHours } = input;

  if (!(oklad >= 0)) return { ok: false, error: "Оклад должен быть числом ≥ 0." };
  if (!(normHours > 0)) return { ok: false, error: "Норма часов должна быть числом > 0." };
  if (!(workedHours >= 0)) return { ok: false, error: "Отработанные часы должны быть числом ≥ 0." };
  if (!(nightHours >= 0)) return { ok: false, error: "Ночные часы должны быть числом ≥ 0." };
  if (nightHours > workedHours) {
    return { ok: false, error: "Ночные часы не могут быть больше отработанных часов." };
  }

  const baseHourRateGross = oklad / normHours;
  const ratio = workedHours / normHours;

  const baseFact = baseHourRateGross * workedHours; // брутто
  const bonus = oklad * BONUS_RATE * ratio; // брутто
  const nightExtra = baseHourRateGross * nightHours * NIGHT_EXTRA_RATE; // брутто

  const gross = baseFact + bonus + nightExtra;
  const tax = gross * TAX_RATE;
  const net = gross - tax;

  const hourRate = (oklad * (1 + BONUS_RATE) * (1 - TAX_RATE)) / normHours; // нетто

  return {
    ok: true,
    result: { hourRate, baseFact, nightExtra, bonus, gross, tax, net },
  };
}