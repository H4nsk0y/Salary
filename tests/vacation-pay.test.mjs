import assert from "node:assert/strict";
import { test } from "node:test";

import {
  calculateVacationPayCalendarDays,
  calculateVacationPayFromHistory,
  extractConfirmedVacationPayIncome,
  VACATION_PAY_AVERAGE_CALENDAR_DAYS,
} from "../vacationPay.js";

function confirmedPayload(net, extra = {}) {
  return {
    ...extra,
    paySummary: {
      actual: {
        net,
        confirmedAt: "2026-08-01T10:00:00.000Z",
        ...extra.paySummary?.actual,
      },
    },
  };
}

test("fully worked month contributes 29.3 calendar days", () => {
  assert.equal(calculateVacationPayCalendarDays(2026, 0, {}), 29.3);
});

test("partial month uses the statutory 29.3 proportional formula", () => {
  const result = calculateVacationPayCalendarDays(2026, 3, {
    leaveType: { 0: "sick" },
  });

  assert.equal(result, (29.3 / 30) * 29);
});

test("matching absence codes bridge ordinary weekends", () => {
  const result = calculateVacationPayCalendarDays(2026, 2, {
    leaveType: { 5: "vac_paid", 8: "vac_paid" },
  });

  assert.equal(result, (29.3 / 31) * 27);
});

test("public holiday inside annual vacation remains a payable-period exclusion exception", () => {
  const result = calculateVacationPayCalendarDays(2026, 0, {
    leaveType: { 0: "vac_paid", 1: "vac_paid" },
    isHoliday: { 0: true },
  });

  assert.equal(result, (29.3 / 31) * 30);
});

test("confirmed income excludes separately recorded vacation and sick-leave payments", () => {
  const income = extractConfirmedVacationPayIncome(
    confirmedPayload(50_000, {
      paySummary: { actual: { paidLeaveNet: 12_500 } },
    })
  );

  assert.equal(income, 50_000);
});

test("August vacation uses August through July of the preceding 12 full months", () => {
  const rows = [];
  for (let offset = 12; offset >= 1; offset -= 1) {
    const date = new Date(2026, 7 - offset, 1);
    rows.push({
      year: date.getFullYear(),
      month: date.getMonth(),
      payload: confirmedPayload(50_000),
    });
  }

  const result = calculateVacationPayFromHistory({
    baseYear: 2026,
    baseMonth: 7,
    vacationDays: 14,
    rows,
  });

  assert.equal(result.ok, true);
  assert.equal(result.fallback, false);
  assert.deepEqual(
    [result.usedRows[0].year, result.usedRows[0].month, result.usedRows.at(-1).year, result.usedRows.at(-1).month],
    [2025, 7, 2026, 6]
  );
  assert.ok(
    Math.abs(result.totalCalendarDays - 12 * VACATION_PAY_AVERAGE_CALENDAR_DAYS) < 1e-9
  );
});

test("incomplete statutory period is clearly marked as a fallback", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    year: index < 6 ? 2025 : 2026,
    month: index < 6 ? index : index - 6,
    payload: confirmedPayload(45_000),
  }));

  const result = calculateVacationPayFromHistory({
    baseYear: 2026,
    baseMonth: 7,
    vacationDays: 14,
    rows,
  });

  assert.equal(result.ok, true);
  assert.equal(result.fallback, true);
});

test("excluded periods reduce the denominator instead of lowering average earnings", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    year: index < 5 ? 2025 : 2026,
    month: index < 5 ? index + 7 : index - 5,
    payload: confirmedPayload(50_000),
  }));
  rows[0].payload.leaveType = { 0: "vac_paid", 1: "vac_paid", 2: "vac_paid" };

  const result = calculateVacationPayFromHistory({
    baseYear: 2026,
    baseMonth: 7,
    vacationDays: 14,
    rows,
  });
  const oldFixedEstimate = (600_000 / (12 * 29.3)) * 14;

  assert.equal(result.ok, true);
  assert.ok(result.amount > oldFixedEstimate);
});
