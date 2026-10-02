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
  assert.match(sql, /'productionCalendarVersion'/);
});

test("ordinary EGAIS members receive a read-only team schedule entry point", async () => {
  const [admin, table, schedule, restore] = await Promise.all([
    read("js/admin.js"),
    read("js/table.js"),
    read("js/schedule.js"),
    read("supabase-sql/063_restore_egais_department_view.sql"),
  ]);

  assert.match(table, /membershipDepartmentKey === "egais"/);
  assert.match(table, /readOnly: true/);
  assert.match(admin, /requestedDepartmentKey === "egais" && membershipDepartmentKey === "egais"/);
  assert.match(admin, /departmentViewOnly = true/);
  assert.match(schedule, /myDepartmentKey === "egais"/);
  assert.match(restore, /department_members[\s\S]*department_key = 'egais'/);
  assert.match(restore, /department_editors[\s\S]*department_key = 'egais'/);
  assert.match(restore, /revoke all[\s\S]*from public, anon/i);
});

test("department editors can remove ordinary members through a protected RPC", async () => {
  const [sql, admin, db] = await Promise.all([
    read("supabase-sql/042_department_member_management.sql"),
    read("js/admin.js"),
    read("js/db.js"),
  ]);

  assert.match(sql, /can_edit_department\(v_department_key\)/);
  assert.match(sql, /CANNOT_REMOVE_SELF/);
  assert.match(sql, /PROTECTED_MEMBER/);
  assert.match(sql, /revoke all on function public\.remove_managed_department_member[\s\S]*from anon/i);
  assert.match(db, /removeManagedDepartmentMember/);
  assert.match(admin, /removeButton\.textContent = "×"/);
  assert.match(admin, /Убрать сотрудника из отдела/);
  assert.match(admin, /await confirmDialog\(\{/);
});

test("desktop schedule controls share a fixed control height", async () => {
  const schedule = await read("schedule.html");

  assert.match(schedule, /\.schedule-control-button\s*\{[\s\S]*?height:\s*42px/);
  assert.match(schedule, /\.schedule-department-label > span\.relative,[\s\S]*?#scheduleDepartmentSelect\s*\{[\s\S]*?height:\s*42px/);
});
