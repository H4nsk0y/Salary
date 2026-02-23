// /calc.js

/**
 * @typedef {Object} SalaryInput
 * @property {number} oklad
 * @property {number} normHours
 * @property {number} workedHours
 * @property {number} nightHours
 */

/**
 * @typedef {Object} SalaryResult
 * @property {number} hourRate
 * @property {number} baseFact
 * @property {number} nightExtra
 * @property {number} bonus
 * @property {number} gross
 * @property {number} tax
 * @property {number} net
 */

export const BONUS_RATE = 0.35;
export const TAX_RATE = 0.13;
export const NIGHT_EXTRA_RATE = 0.4;

/**
 * Parses user input like "50 000", "50000", "50,000" (comma as decimal).
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
 * @param {number} value
 * @returns {string}
 */
export function formatRUB(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * @param {SalaryInput} input
 * @returns {{ ok: true, result: SalaryResult } | { ok: false, error: string }}
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

  const hourRate = oklad / normHours;
  const baseFact = hourRate * workedHours;
  const nightExtra = hourRate * nightHours * NIGHT_EXTRA_RATE;
  const bonus = baseFact * BONUS_RATE;

  const gross = baseFact + bonus + nightExtra;
  const tax = gross * TAX_RATE;
  const net = gross - tax;

  return {
    ok: true,
    result: { hourRate, baseFact, nightExtra, bonus, gross, tax, net },
  };
}