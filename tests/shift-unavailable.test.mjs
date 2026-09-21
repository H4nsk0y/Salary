import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("employees can report only their own scheduled shift", async () => {
  const [sql, db, table] = await Promise.all([
    read("supabase-sql/053_shift_unavailable_reports.sql"),
    read("js/db.js"),
    read("js/table.js"),
  ]);

  assert.match(sql, /auth\.uid\(\)/);
  assert.match(sql, /where timesheet\.user_id = v_user_id/);
  assert.match(sql, /SHIFT_NOT_SCHEDULED/);
  assert.match(sql, /Комментарий от сотрудника: Не смогу выйти/);
  assert.match(sql, /department_timesheet_audit_log/);
  assert.match(db, /report_my_shift_unavailable/);
  assert.match(table, /reportSelectedShiftUnavailable/);
  assert.match(table, /Саму смену система не удалит/);
});

test("shift unavailable report notifies department leaders and editors", async () => {
  const [sql, edge, html] = await Promise.all([
    read("supabase-sql/053_shift_unavailable_reports.sql"),
    read("supabase/functions/send-push-notifications/index.ts"),
    read("table.html"),
  ]);

  assert.match(sql, /from public\.department_editors editor/);
  assert.match(sql, /'shift_unavailable'/);
  assert.match(sql, /can_send_shift_unavailable_push/);
  assert.match(edge, /isShiftUnavailable/);
  assert.match(edge, /can_send_shift_unavailable_push/);
  assert.match(html, /id="shiftUnavailableBtn"/);
  assert.doesNotMatch(html, /id="logoutBtn"/);
});
