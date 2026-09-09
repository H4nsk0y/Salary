import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("department timesheet saves are audited atomically on the server", async () => {
  const [sql, db, admin] = await Promise.all([
    read("supabase-sql/043_department_timesheet_audit.sql"),
    read("db.js"),
    read("admin.js"),
  ]);

  assert.match(sql, /create table if not exists public\.department_timesheet_audit_log/i);
  assert.match(sql, /create or replace function public\.managed_save_department_timesheets/i);
  assert.match(sql, /if not public\.can_edit_department\(v_department_key\)/i);
  assert.match(sql, /MEMBER_NOT_FOUND/);
  assert.match(sql, /insert into public\.timesheets[\s\S]*insert into public\.department_timesheet_audit_log/i);
  assert.match(db, /supabase\.rpc\("managed_save_department_timesheets"/);
  assert.match(admin, /managedSaveManyTimesheets\(managedDepartment\?\.key, items\)/);
});

test("only the owner can read department timesheet history", async () => {
  const [sql, html, admin, db] = await Promise.all([
    read("supabase-sql/043_department_timesheet_audit.sql"),
    read("admin.html"),
    read("admin.js"),
    read("db.js"),
  ]);

  assert.match(sql, /owner_list_department_timesheet_audit[\s\S]*if not public\.is_owner\(\)/i);
  assert.match(sql, /revoke all on public\.department_timesheet_audit_log from public, anon, authenticated/i);
  assert.match(sql, /revoke all on function public\.owner_list_department_timesheet_audit[\s\S]*from public, anon/i);
  assert.match(html, /id="auditLogBtn"[\s\S]*>Журнал<\/button>/);
  assert.match(html, /id="auditLogModal"[\s\S]*aria-modal="true"/);
  assert.match(admin, /auditLogBtn\?\.classList\.toggle\("hidden", !isOwner\)/);
  assert.match(admin, /currentProfile\?\.role !== "owner"/);
  assert.match(db, /ownerListDepartmentTimesheetAudit/);
});

test("audit UI renders changed shifts, comments and department calendar marks", async () => {
  const admin = await read("admin.js");

  assert.match(admin, /auditShiftLabel/);
  assert.match(admin, /auditCalendarLabel/);
  assert.match(admin, /добавлен комментарий/);
  assert.match(admin, /employee_changes/);
  assert.match(admin, /calendar_changes/);
});
