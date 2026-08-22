import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { buildDecemberForecast, estimateYearEndReserve } from "../yearEndReserve.js";

const root = new URL("../", import.meta.url);

test("annual overtime uses 1.5x for first two hours and 2x afterwards", () => {
  const result = estimateYearEndReserve([{
    overtimeBalanceHours: 10,
    compensatoryLeaveHours: 0,
    holidayHours: 0,
    overtimeHourlyGross: 500,
    workedNonHolidayHours: 160,
  }]);

  assert.equal(result.overtimeHoursOneAndHalf, 2);
  assert.equal(result.overtimeHoursDouble, 8);
  assert.equal(result.overtimeReserveNet, 3915);
});

test("holiday hours are not counted twice as annual overtime", () => {
  const result = estimateYearEndReserve([{
    overtimeBalanceHours: 11,
    holidayHours: 8,
    holidayExtraNet: 4000,
    overtimeHourlyGross: 500,
    workedNonHolidayHours: 160,
  }]);

  assert.equal(result.overtimeHours, 3);
  assert.equal(result.holidayReserveNet, 2000);
});

test("confirmed holiday payment gap calibrates the reserved share", () => {
  const result = estimateYearEndReserve([{
    overtimeBalanceHours: 8,
    holidayHours: 8,
    holidayExtraNet: 5000,
    calculatedNet: 50000,
    actualNet: 47500,
    actualConfirmed: true,
    overtimeHourlyGross: 500,
    workedNonHolidayHours: 152,
  }]);

  assert.equal(result.holidayReserveShare, 0.5);
  assert.equal(result.confirmedHolidayMonths, 1);
  assert.equal(result.totalReserveNet, 2500);
});

test("December forecast adds the reserve without changing monthly calculation", () => {
  assert.deepEqual(
    buildDecemberForecast({ decemberAutoNet: 60000, reserve: { totalReserveNet: 14000 } }),
    { decemberAutoNet: 60000, reserveNet: 14000, expectedNet: 74000 }
  );
});

test("profile exposes the forecast only on December and respects money protection", async () => {
  const profile = await readFile(new URL("profile.js", root), "utf8");
  assert.match(profile, /if \(m === 11 && yearEndForecast\)/);
  assert.match(profile, /isMoneyProtectionEnabled\(currentProfile\)[\s\S]*ensureProfileMoneyAccess\(\)/);
  assert.match(profile, /Это ориентир, а не расчетный лист/);
});
