import { normalizeLeaveTypeLegacy } from "./features/timesheetValues.js";

const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function at(values, index) {
  return positiveNumber(Array.isArray(values) ? values[index] : 0);
}

function same(value, expected) {
  return Math.abs(positiveNumber(value) - expected) < .05;
}

function isNightRest(day, night) {
  return (same(day, 1) || same(day, 2)) && same(night, 5);
}

function isNightStart(day, night) {
  return (same(day, 2) && same(night, 2)) || ((same(day, 3) || same(day, 4)) && same(night, 7));
}

function savedNet(payload) {
  const summary = payload?.paySummary;
  const actual = summary?.actual;
  if (actual?.confirmedAt) {
    return {
      value: positiveNumber(actual.net) + positiveNumber(actual.paidLeaveNet),
      confirmed: true,
    };
  }
  const calculated = summary?.calculated ?? summary;
  return { value: positiveNumber(calculated?.net), confirmed: false };
}

export function buildYearReview(rows, year) {
  const months = new Array(12).fill(null).map((_, month) => ({ month, hours: 0, shifts: 0 }));
  const workedDates = new Set();
  let totalHours = 0;
  let dayHours = 0;
  let nightHours = 0;
  let shifts = 0;
  let nightShifts = 0;
  let holidayHours = 0;
  let vacationDays = 0;
  let sickDays = 0;
  let otherAbsenceDays = 0;
  let savedPayments = 0;
  let paymentMonths = 0;
  let confirmedPaymentMonths = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    const payload = row?.payload;
    const month = Number(row?.month);
    if (!payload || !Number.isInteger(month) || month < 0 || month > 11) continue;
    const days = new Date(year, month + 1, 0).getDate();

    for (let index = 0; index < days; index += 1) {
      const day = at(payload.dayHours, index);
      const night = at(payload.nightHours, index);
      const leave = normalizeLeaveTypeLegacy(payload.leaveType?.[index]);
      const hours = day + night;
      totalHours += hours;
      dayHours += day;
      nightHours += night;
      months[month].hours += hours;

      if (payload.isHoliday?.[index]) holidayHours += hours;
      if (leave === "vac_paid") vacationDays += 1;
      else if (leave === "sick") sickDays += 1;
      else if (leave && leave !== "not_employed" && leave !== "dismissed") otherAbsenceDays += 1;

      if (!leave && hours > 0 && !isNightRest(day, night)) {
        shifts += 1;
        months[month].shifts += 1;
        workedDates.add(`${year}-${String(month + 1).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`);
        if (isNightStart(day, night)) nightShifts += 1;
      }
    }

    const payment = savedNet(payload);
    if (payment.value > 0) {
      savedPayments += payment.value;
      paymentMonths += 1;
      if (payment.confirmed) confirmedPaymentMonths += 1;
    }
  }

  let longestStreak = 0;
  let currentStreak = 0;
  for (let date = new Date(year, 0, 1, 12); date.getFullYear() === year; date.setDate(date.getDate() + 1)) {
    const key = `${year}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    currentStreak = workedDates.has(key) ? currentStreak + 1 : 0;
    longestStreak = Math.max(longestStreak, currentStreak);
  }

  const activeMonths = months.filter((month) => month.hours > 0 || month.shifts > 0);
  const busiestMonth = activeMonths.reduce((best, month) => !best || month.hours > best.hours ? month : best, null);

  return {
    year,
    monthsWithData: (Array.isArray(rows) ? rows : []).filter((row) => row?.payload).length,
    totalHours,
    dayHours,
    nightHours,
    shifts,
    nightShifts,
    holidayHours,
    vacationDays,
    sickDays,
    otherAbsenceDays,
    longestStreak,
    busiestMonth: busiestMonth ? { ...busiestMonth, name: MONTH_NAMES[busiestMonth.month] } : null,
    savedPayments,
    paymentMonths,
    confirmedPaymentMonths,
  };
}
