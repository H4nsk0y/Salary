import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { getAdjacentMonthPeriods } from "../js/features/monthPrefetch.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("adjacent month periods cross year boundaries correctly", () => {
  assert.deepEqual(getAdjacentMonthPeriods(2026, 0), [
    { year: 2025, month: 11 },
    { year: 2026, month: 1 },
  ]);
  assert.deepEqual(getAdjacentMonthPeriods(2026, 11), [
    { year: 2026, month: 10 },
    { year: 2027, month: 0 },
  ]);
});

test("personal and department timesheets prefetch both adjacent months", async () => {
  const [table, admin, db] = await Promise.all([
    read("js/table.js"),
    read("js/admin.js"),
    read("js/db.js"),
  ]);

  assert.match(table, /scheduleAdjacentMonthPrefetch\(/);
  assert.match(table, /loadTimesheet\(adjacentYear, adjacentMonth\)/);
  assert.match(table, /listMyTimesheetsBefore\(adjacentYear, adjacentMonth/);
  assert.match(admin, /scheduleAdjacentMonthPrefetch\(/);
  assert.match(admin, /managedLoadTimesheets\(userIds, adjacentYear, adjacentMonth\)/);
  assert.match(admin, /listEgaisDepartmentTimesheetView\(adjacentYear, adjacentMonth\)/);
  assert.match(db, /const READ_CACHE_TTL_MS = 60_000/);
  assert.match(db, /clearTimesheetHistoryReadCaches\(\)/);
});
