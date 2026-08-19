import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("EGAIS department view is server-authorized and excludes payroll data", async () => {
  const sql = await read("supabase-sql/030_egais_department_timesheet_view.sql");

  assert.match(sql, /department_members[\s\S]*department_key = 'egais'/);
  assert.match(sql, /list_egais_department_timesheet_view/);
  assert.match(sql, /revoke all[\s\S]*from anon/i);
  assert.match(sql, /grant execute[\s\S]*to authenticated/i);
  assert.doesNotMatch(sql, /t\.payload\s+as\s+payload/i);
  assert.doesNotMatch(sql, /'moneySnapshot'|'paySummary'|'actual'/);
});

test("ordinary EGAIS members receive a read-only team schedule entry point", async () => {
  const [admin, table, db] = await Promise.all([
    read("admin.js"),
    read("table.js"),
    read("db.js"),
  ]);

  assert.match(table, /membershipDepartmentKey === "egais"/);
  assert.match(table, /График отдела ЕГАИС/);
  assert.match(admin, /departmentViewOnly = true/);
  assert.match(admin, /input\.readOnly = true/);
  assert.match(admin, /if \(departmentViewOnly\) return;/);
  assert.match(db, /listEgaisDepartmentTimesheetView/);
});

test("desktop schedule controls share a fixed control height", async () => {
  const schedule = await read("schedule.html");

  assert.match(schedule, /\.schedule-control-button\s*\{[\s\S]*?height:\s*42px/);
  assert.match(schedule, /\.schedule-department-label > span\.relative,[\s\S]*?#scheduleDepartmentSelect\s*\{[\s\S]*?height:\s*42px/);
});
