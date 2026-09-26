import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { accruedVacationMonths, buildVacationPlan, projectVacationBalance } from "../js/vacationPlanner.js";

test("vacation balance accrues on the first day of each following calendar month", () => {
  assert.equal(accruedVacationMonths("2026-09-26", "2026-09-30"), 0);
  assert.equal(accruedVacationMonths("2026-09-26", "2026-10-01"), 1);
  assert.equal(accruedVacationMonths("2026-09-26", "2027-01-01"), 4);
  const projected = projectVacationBalance({ balance:15.6, asOfDate:"2026-09-26", annualDays:28, targetDate:"2026-10-01" });
  assert.equal(projected.balance, 17.93);
  assert.ok(Math.abs(projected.accrualPerMonth - 28 / 12) < 1e-9);
});

test("completed October vacation is deducted after the November accrual", () => {
  const october = projectVacationBalance({
    balance:17.67,
    asOfDate:"2026-09-26",
    annualDays:28,
    targetDate:"2026-10-01",
  });
  const november = projectVacationBalance({
    balance:17.67,
    asOfDate:"2026-09-26",
    annualDays:28,
    targetDate:"2026-11-02",
  });

  assert.equal(october.balance, 20);
  assert.equal(november.balance, 22.34);
  assert.equal(Number((november.balance - 14).toFixed(2)), 8.34);
});

test("official holidays extend vacation without consuming a vacation day", () => {
  const plan = buildVacationPlan({
    startDate:"2026-11-02",
    vacationDays:14,
    holidayDates:["2026-11-04"],
  });
  assert.equal(plan.endDate, "2026-11-16");
  assert.equal(plan.nextCalendarDate, "2026-11-17");
  assert.equal(plan.calendarSpanDays, 15);
  assert.deepEqual(plan.excludedHolidays, ["2026-11-04"]);
});

test("profile exposes the vacation planner and removes the legacy calendar", async () => {
  const [html, script, tour] = await Promise.all([
    readFile(new URL("../profile.html", import.meta.url), "utf8"),
    readFile(new URL("../js/profile.js", import.meta.url), "utf8"),
    readFile(new URL("../js/tour.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="vacationPlanner"/);
  assert.match(html, /id="vacationBalanceInput"/);
  assert.match(html, /id="vacationOverlapsList"/);
  assert.doesNotMatch(html, /id="calGrid"/);
  assert.match(script, /listDepartmentVacationOverlaps/);
  assert.doesNotMatch(script, /renderCalendar\(/);
  assert.match(tour, /element: "#vacationPlanner"/);
});

test("vacation SQL limits balance and overlap data to an authenticated user department", async () => {
  const [plannerSql, eventsSql, db] = await Promise.all([
    readFile(new URL("../supabase-sql/060_vacation_planner.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase-sql/061_vacation_balance_events.sql", import.meta.url), "utf8"),
    readFile(new URL("../js/db.js", import.meta.url), "utf8"),
  ]);

  assert.match(plannerSql, /enable row level security/i);
  assert.match(plannerSql, /using \(user_id = auth\.uid\(\)\)/i);
  assert.match(plannerSql, /dm\.department_key = v_department_key/i);
  assert.match(plannerSql, /dm\.user_id <> auth\.uid\(\)/i);
  assert.match(plannerSql, /grant execute on function public\.list_department_vacation_overlaps/i);
  assert.match(eventsSql, /event\.end_date < v_today/i);
  assert.match(eventsSql, /status = 'finalized'/i);
  assert.match(eventsSql, /trg_track_timesheet_vacation_balance/i);
  assert.match(eventsSql, /alvisa-finalize-vacation-balances/i);
  assert.match(db, /rpc\("get_my_vacation_balance"\)/);
});
