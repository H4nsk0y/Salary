export const VACATION_PAY_MONTHS_REQUIRED = 12;
export const VACATION_PAY_AVERAGE_CALENDAR_DAYS = 29.3;

const PAID_VACATION = "vac_paid";

function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function normalizeLeaveType(value) {
  if (!value) return null;
  if (value === "vacation") return PAID_VACATION;
  if (value === "sick") return "sick";

  const token = String(value).trim();
  const upper = token.toUpperCase();
  if (upper === "О" || upper === "ОТ") return PAID_VACATION;
  if (upper === "ОД") return "vac_unpaid";
  if (upper === "ОЗ") return "vac_unpaid_required";
  if (upper === "Б" || upper === "БЛ") return "sick";
  if (upper === "У") return "edu_paid";
  if (upper === "УД") return "edu_unpaid";
  if (upper === "НТ") return "not_employed";
  if (upper === "УВ") return "dismissed";
  return token;
}

function isWeekend(year, month, dayIndex) {
  const day = new Date(year, month, dayIndex + 1).getDay();
  return day === 0 || day === 6;
}

function isBridgeDay(payload, year, month, dayIndex) {
  return (
    isWeekend(year, month, dayIndex) ||
    Boolean(payload?.isHoliday?.[dayIndex]) ||
    Boolean(payload?.isTransferredOff?.[dayIndex])
  );
}

function isExcludedLeaveDay(type, payload, dayIndex) {
  if (!type) return false;

  // A public holiday inside annual leave is not itself a vacation day.
  if (type === PAID_VACATION && payload?.isHoliday?.[dayIndex]) return false;
  return true;
}

export function calculateVacationPayCalendarDays(year, month, payload = {}) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 0 || m > 11) return 0;

  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const leaveTypes = Array.from({ length: daysInMonth }, (_, index) =>
    normalizeLeaveType(payload?.leaveType?.[index])
  );
  const excluded = leaveTypes.map((type, index) =>
    isExcludedLeaveDay(type, payload, index)
  );

  // Older timesheets often contain absence codes only on working days.
  // Join matching absence blocks across weekends and marked non-working days.
  for (let left = 0; left < daysInMonth; left += 1) {
    const type = leaveTypes[left];
    if (!type) continue;

    for (let right = left + 1; right < daysInMonth; right += 1) {
      const rightType = leaveTypes[right];
      if (rightType) {
        if (rightType !== type) break;

        let canBridge = true;
        for (let gap = left + 1; gap < right; gap += 1) {
          if (!isBridgeDay(payload, y, m, gap)) {
            canBridge = false;
            break;
          }
        }

        if (canBridge) {
          for (let gap = left + 1; gap < right; gap += 1) {
            if (isExcludedLeaveDay(type, payload, gap)) excluded[gap] = true;
          }
        }
        break;
      }

      if (!isBridgeDay(payload, y, m, right)) break;
    }
  }

  const excludedDays = excluded.filter(Boolean).length;
  if (excludedDays === 0) return VACATION_PAY_AVERAGE_CALENDAR_DAYS;

  const includedCalendarDays = Math.max(0, daysInMonth - excludedDays);
  return (VACATION_PAY_AVERAGE_CALENDAR_DAYS / daysInMonth) * includedCalendarDays;
}

export function extractConfirmedVacationPayIncome(payload) {
  const actual = payload?.paySummary?.actual;
  if (!actual?.confirmedAt) return null;

  const net = Number(actual.net);
  const advance = Number(actual.advance);
  const remaining = Number(actual.remaining);
  const hasNet = actual.net !== null && actual.net !== undefined && Number.isFinite(net);
  const hasParts =
    (actual.advance !== null && actual.advance !== undefined && Number.isFinite(advance)) ||
    (actual.remaining !== null && actual.remaining !== undefined && Number.isFinite(remaining));
  const hasExcludedPayment =
    actual.paidLeaveNet !== null &&
    actual.paidLeaveNet !== undefined &&
    Number.isFinite(Number(actual.paidLeaveNet));

  if (!hasNet && !hasParts && !hasExcludedPayment) return null;

  // Vacation, study-leave and sick-leave payments are excluded from average earnings.
  const income = hasNet
    ? net
    : hasParts
      ? (Number.isFinite(advance) ? advance : 0) + (Number.isFinite(remaining) ? remaining : 0)
      : 0;

  return Math.max(0, Number(income.toFixed(2)));
}

function getPreviousMonths(baseYear, baseMonth) {
  const months = [];
  for (let offset = VACATION_PAY_MONTHS_REQUIRED; offset >= 1; offset -= 1) {
    const date = new Date(baseYear, baseMonth - offset, 1);
    months.push({ year: date.getFullYear(), month: date.getMonth() });
  }
  return months;
}

function calculateFromRows(rows, vacationDays) {
  let totalIncome = 0;
  let totalCalendarDays = 0;

  for (const row of rows) {
    const income = extractConfirmedVacationPayIncome(row?.payload);
    if (!Number.isFinite(income)) return null;

    totalIncome += income;
    totalCalendarDays += calculateVacationPayCalendarDays(row.year, row.month, row.payload);
  }

  if (!(totalCalendarDays > 0)) return null;
  const averageDaily = totalIncome / totalCalendarDays;
  return {
    totalIncome,
    totalCalendarDays,
    averageDaily,
    amount: averageDaily * vacationDays,
  };
}

export function calculateVacationPayFromHistory({
  baseYear,
  baseMonth,
  vacationDays,
  rows = [],
} = {}) {
  const requestedMonths = getPreviousMonths(baseYear, baseMonth);
  const rowsByMonth = new Map(
    rows.map((row) => [monthKey(Number(row?.year), Number(row?.month)), row])
  );
  const requestedRows = requestedMonths
    .map((item) => rowsByMonth.get(monthKey(item.year, item.month)))
    .filter(Boolean);
  const confirmedRequestedRows = requestedRows.filter((row) =>
    Number.isFinite(extractConfirmedVacationPayIncome(row?.payload))
  );

  if (confirmedRequestedRows.length === VACATION_PAY_MONTHS_REQUIRED) {
    return {
      ok: true,
      fallback: false,
      vacationDays,
      confirmedMonths: VACATION_PAY_MONTHS_REQUIRED,
      requestedMonths,
      usedRows: confirmedRequestedRows,
      ...calculateFromRows(confirmedRequestedRows, vacationDays),
    };
  }

  const fallbackRows = rows
    .filter((row) => Number.isFinite(extractConfirmedVacationPayIncome(row?.payload)))
    .sort((a, b) => Number(b.year) - Number(a.year) || Number(b.month) - Number(a.month))
    .slice(0, VACATION_PAY_MONTHS_REQUIRED);

  if (fallbackRows.length === VACATION_PAY_MONTHS_REQUIRED) {
    return {
      ok: true,
      fallback: true,
      vacationDays,
      confirmedMonths: confirmedRequestedRows.length,
      requestedMonths,
      usedRows: fallbackRows,
      ...calculateFromRows(fallbackRows, vacationDays),
    };
  }

  return {
    ok: false,
    vacationDays,
    confirmedMonths: confirmedRequestedRows.length,
    requestedMonths,
    usedRows: [],
  };
}
