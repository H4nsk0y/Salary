import { resolvePaymentDate } from "./paymentCalendar.js";
import { getProductionCalendarMonth, shouldApplyProductionCalendar } from "../productionCalendar.js";
import { kopecks, salaryMonths } from "./budgetModel.js";
import { computeSalary, computePaymentSplit, normalizeTaxRate, BONUS_RATE, NIGHT_EXTRA_RATE } from "../calc.js";
import { getBaseDayHoursByProfile, normalizeNormSnapshot, normalizeLeaveTypeLegacy } from "./timesheetValues.js";
const key = (year, month) => `${year}-${month}`;
const dateISO = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function salaryAmount(payload, field, fallback) {
  const summary = payload?.paySummary;
  const raw = (summary?.actual?.confirmedAt ? summary.actual[field] : null)
    ?? summary?.calculated?.[field] ?? summary?.[field] ?? fallback?.[field];
  if (!["number", "string"].includes(typeof raw) || !String(raw).trim()) return undefined;
  const amount = kopecks(raw);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : undefined;
}

// Department edits can save hours without a paySummary. Use Salary's formulas,
// but do not invent a schedule or a payment when the month's table is missing.
export function calculateBudgetPayments(payload, profile = {}) {
  if (!payload || !Array.isArray(payload.dayHours) || !Array.isArray(payload.nightHours)) return null;
  const summary = payload.paySummary?.calculated ?? payload.paySummary ?? {};
  const snapshot = payload.moneySnapshot ?? {};
  const base = Number(snapshot.okladSnapshot ?? summary.okladSnapshot ?? profile.oklad);
  const hazard = Number(snapshot.hazardRateSnapshot ?? summary.hazardRate ?? (/грузчик/i.test(profile.position ?? "") ? .04 : 0));
  const effective = Number(snapshot.effectiveOkladSnapshot ?? summary.effectiveOkladSnapshot ?? (base * (1 + hazard)).toFixed(2));
  if (!(effective > 0) || !Number.isFinite(effective)) return null;
  const baseHours = normalizeNormSnapshot(payload.normSnapshot)?.baseDayHours ?? getBaseDayHoursByProfile(profile);
  const length = new Date(payload.year, payload.month + 1, 0).getDate();
  let norm = 0;
  const days = [], nights = [];
  let holidayDay = 0, holidayNight = 0;
  for (let i = 0; i < length; i++) {
    const weekday = new Date(payload.year, payload.month, i + 1).getDay();
    if (![0, 6].includes(weekday) && !payload.isHoliday?.[i] && !payload.isTransferredOff?.[i]) {
      norm += Math.max(0, baseHours - (payload.isShortDay?.[i] ? 1 : 0));
    }
    const absent = normalizeLeaveTypeLegacy(payload.leaveType?.[i]);
    days.push(absent ? 0 : Math.max(0, Number(payload.dayHours[i]) || 0));
    nights.push(absent ? 0 : Math.max(0, Number(payload.nightHours[i]) || 0));
    if (payload.isHoliday?.[i]) { holidayDay += days[i]; holidayNight += nights[i]; }
  }
  const total = values => values.reduce((sum, value) => sum + value, 0);
  const taxRate = normalizeTaxRate(summary.taxRate ?? profile.tax_rate);
  const calculation = computeSalary({ oklad: effective, normHours: norm, workedHours: total(days) + total(nights), nightHours: total(nights), taxRate });
  if (!calculation.ok) return null;
  const holidayExtra = effective / norm * ((1 + BONUS_RATE) * (holidayDay + holidayNight) + NIGHT_EXTRA_RATE * holidayNight);
  return computePaymentSplit({ netTotal: calculation.result.net + holidayExtra * (1 - taxRate), effectiveOklad: effective,
    monthNorm: norm, firstHalfDayHours: total(days.slice(0, 15)), firstHalfNightHours: total(nights.slice(0, 15)), taxRate });
}

export async function buildBudgetSalary(rows, today, branch, loadCalendar = getProductionCalendarMonth, profile = {}) {
  const payloads = new Map(rows.map((row) => [key(row.year, row.month), row.payload]));
  const calendars = new Map();
  const marksFor = async (date) => {
    const monthKey = key(date.getFullYear(), date.getMonth());
    if (!calendars.has(monthKey)) {
      calendars.set(monthKey, (async () => {
        const payload = payloads.get(monthKey);
        const calendar = await loadCalendar(date.getFullYear(), date.getMonth(), { branch });
        return shouldApplyProductionCalendar(payload, calendar) ? calendar : payload ?? calendar;
      })());
    }
    return calendars.get(monthKey);
  };
  const nonWorking = async (date) => {
    if ([0, 6].includes(date.getDay())) return true;
    const marks = await marksFor(date);
    const index = date.getDate() - 1;
    return Boolean(marks?.isHoliday?.[index] || marks?.isTransferredOff?.[index]);
  };
  const payments = [];
  for (const { year, month } of salaryMonths(today)) {
    const payload = payloads.get(key(year, month));
    const fallback = payload ? calculateBudgetPayments({ ...payload, ...await marksFor(new Date(year, month, 1)), year, month }, { ...profile, branch }) : null;
    for (const [field, offset, payday] of [["advance", 0, 25], ["remaining", 1, 10]]) {
      const raw = new Date(year, month + offset, payday);
      payments.push({
        nominal: dateISO(raw), date: dateISO(await resolvePaymentDate(raw, nonWorking)),
        amount: salaryAmount(payload, field, fallback), source: "salary",
        confirmed: Boolean(payload?.paySummary?.actual?.confirmedAt && payload.paySummary.actual[field] != null),
      });
    }
  }
  return payments;
}
