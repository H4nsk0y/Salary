import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("employees receive a two-month checklist archive on a separate page", async () => {
  const [migration, page, archivePage, client] = await Promise.all([
    read("supabase-sql/057_checklist_archive_and_inactive_report.sql"),
    read("checklist.html"),
    read("checklist-history.html"),
    read("js/checklistHistory.js"),
  ]);

  assert.match(migration, /get_my_shift_checklist_history/);
  assert.match(migration, /completed_at >= now\(\) - interval '2 months'/i);
  assert.match(migration, /delete from public\.shift_checklists[\s\S]*completed_at < now\(\) - interval '2 months'/i);
  assert.match(page, /href="checklist-history\.html"/);
  assert.doesNotMatch(page, /id="historyPanel"/);
  assert.match(archivePage, /id="archiveList"/);
  assert.match(client, /getMyShiftChecklistHistory/);
});

test("monthly maintenance reports inactive users only to owners", async () => {
  const [migration, edge] = await Promise.all([
    read("supabase-sql/057_checklist_archive_and_inactive_report.sql"),
    read("supabase/functions/send-push-notifications/index.ts"),
  ]);

  assert.match(migration, /coalesce\(presence\.last_seen, profile\.created_at\) < now\(\) - interval '2 months'/i);
  assert.match(migration, /owner_inactive_users_report/);
  assert.match(migration, /owner_profile\.role = 'owner'/i);
  assert.match(migration, /'15 0 1 \* \*'/);
  assert.match(edge, /trustedCron/);
  assert.match(edge, /constantTimeEqual/);
});

test("admin timesheet excludes incomplete profiles", async () => {
  const db = await read("js/db.js");
  assert.match(db, /filter\(\(member\) => isProfileCompleteForTimesheet\(member\)\)/);
});
