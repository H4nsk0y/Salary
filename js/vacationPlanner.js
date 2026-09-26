export const DEFAULT_ANNUAL_VACATION_DAYS = 28;

function validDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return null;
  return date;
}

export function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function accruedVacationMonths(asOfDate, targetDate) {
  const base = validDate(asOfDate);
  const target = validDate(targetDate);
  if (!base || !target) return 0;
  return Math.max(0, (target.getFullYear() - base.getFullYear()) * 12 + target.getMonth() - base.getMonth());
}

export function projectVacationBalance({ balance, asOfDate, annualDays = DEFAULT_ANNUAL_VACATION_DAYS, targetDate } = {}) {
  const normalizedBalance = Number(balance);
  const normalizedAnnualDays = Number(annualDays);
  if (!Number.isFinite(normalizedBalance) || !Number.isFinite(normalizedAnnualDays) || normalizedAnnualDays <= 0) return null;
  const months = accruedVacationMonths(asOfDate, targetDate);
  const accrualPerMonth = normalizedAnnualDays / 12;
  return {
    balance:Number((normalizedBalance + months * accrualPerMonth).toFixed(2)),
    months,
    accrualPerMonth,
  };
}

export function buildVacationPlan({ startDate, vacationDays, holidayDates = [] } = {}) {
  const start = validDate(startDate);
  const chargedDaysTarget = Number(vacationDays);
  if (!start || !Number.isInteger(chargedDaysTarget) || chargedDaysTarget < 1 || chargedDaysTarget > 60) return null;
  const holidays = new Set((holidayDates || []).map(String));
  const excludedHolidays = [];
  const current = new Date(start);
  let chargedDays = 0;
  let safety = 0;

  while (chargedDays < chargedDaysTarget && safety < 100) {
    const key = formatLocalDate(current);
    if (holidays.has(key)) excludedHolidays.push(key);
    else chargedDays += 1;
    if (chargedDays < chargedDaysTarget) current.setDate(current.getDate() + 1);
    safety += 1;
  }

  const end = new Date(current);
  const nextCalendarDate = new Date(end);
  nextCalendarDate.setDate(nextCalendarDate.getDate() + 1);
  return {
    startDate:formatLocalDate(start),
    endDate:formatLocalDate(end),
    nextCalendarDate:formatLocalDate(nextCalendarDate),
    vacationDays:chargedDaysTarget,
    calendarSpanDays:Math.round((end - start) / 86400000) + 1,
    excludedHolidays,
  };
}
