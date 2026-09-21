import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("department timesheet saves are audited atomically on the server", async () => {
  const [sql, db, admin] = await Promise.all([
    read("supabase-sql/043_department_timesheet_audit.sql"),
    read("js/db.js"),
    read("js/admin.js"),
  ]);

  assert.match(sql, /create table if not exists public\.department_timesheet_audit_log/i);
  assert.match(sql, /create or replace function public\.managed_save_department_timesheets/i);
  assert.match(sql, /if not public\.can_edit_department\(v_department_key\)/i);
  assert.match(sql, /MEMBER_NOT_FOUND/);
  assert.match(sql, /insert into public\.timesheets[\s\S]*insert into public\.department_timesheet_audit_log/i);
  assert.match(db, /supabase\.rpc\("managed_save_department_timesheets_v2"/);
  assert.match(admin, /managedSaveManyTimesheets\(managedDepartment\?\.key, items\)/);
});

test("department timesheet saves reject stale editor versions", async () => {
  const [sql, db, admin] = await Promise.all([
    read("supabase-sql/052_timesheet_edit_conflicts.sql"),
    read("js/db.js"),
    read("js/admin.js"),
  ]);

  assert.match(sql, /managed_save_department_timesheets_v2/);
  assert.match(sql, /for update/i);
  assert.match(sql, /TIMESHEET_CONFLICT/);
  assert.match(sql, /managed_save_department_timesheets\(v_department_key, p_items\)/);
  assert.match(sql, /'versions', v_versions/);
  assert.match(db, /select\("user_id, payload, updated_at"\)/);
  assert.match(db, /expected_updated_at/);
  assert.match(db, /supabase\.rpc\("managed_save_department_timesheets_v2"/);
  assert.match(db, /Array\.isArray\(data\?\.versions\)/);
  assert.match(admin, /state\.updatedAt/);
  assert.match(admin, /Этот табель уже изменил другой редактор/);
});

test("only the owner can read department timesheet history", async () => {
  const [sql, html, admin, db] = await Promise.all([
    read("supabase-sql/043_department_timesheet_audit.sql"),
    read("admin.html"),
    read("js/admin.js"),
    read("js/db.js"),
  ]);

  assert.match(sql, /owner_list_department_timesheet_audit[\s\S]*if not public\.is_owner\(\)/i);
  assert.match(sql, /revoke all on public\.department_timesheet_audit_log from public, anon, authenticated/i);
  assert.match(sql, /revoke all on function public\.owner_list_department_timesheet_audit[\s\S]*from public, anon/i);
  assert.match(html, /id="auditLogBtn"[\s\S]{0,300}aria-label="Журнал изменений"/);
  assert.match(html, /id="auditLogModal"[\s\S]*aria-modal="true"/);
  assert.match(admin, /auditLogBtn\?\.classList\.toggle\("hidden", !isOwner\)/);
  assert.match(admin, /currentProfile\?\.role !== "owner"/);
  assert.match(db, /ownerListDepartmentTimesheetAudit/);
});

test("audit UI renders changed shifts, comments and department calendar marks", async () => {
  const admin = await read("js/admin.js");

  assert.match(admin, /auditShiftLabel/);
  assert.match(admin, /auditCalendarLabel/);
  assert.match(admin, /добавлен комментарий/);
  assert.match(admin, /employee_changes/);
  assert.match(admin, /calendar_changes/);
});

test("audit search supports partial names across the full month history", async () => {
  const [sql, html, admin, db] = await Promise.all([
    read("supabase-sql/050_search_department_timesheet_audit.sql"),
    read("admin.html"),
    read("js/admin.js"),
    read("js/db.js"),
  ]);

  assert.match(html, /id="auditLogSearch"[^>]*type="search"/);
  assert.match(admin, /filterAuditEntries\(auditLogEntries, query\)/);
  assert.match(admin, /setTimeout\(\(\) => void searchAuditLog\(\), 250\)/);
  assert.match(db, /supabase\.rpc\("owner_search_department_timesheet_audit"/);
  assert.match(sql, /if not public\.is_owner\(\)/i);
  assert.match(sql, /position\(v_query in lower\(translate/i);
  assert.match(sql, /limit least\(greatest\(coalesce\(p_limit, 200\), 1\), 200\)/i);
  assert.match(sql, /revoke all on function public\.owner_search_department_timesheet_audit[\s\S]*from public, anon/i);
});
