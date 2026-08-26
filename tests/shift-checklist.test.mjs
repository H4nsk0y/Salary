import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  checklistProgress,
  createChecklistItem,
  EGAIS_REQUIRED_CHECKLIST_ITEM,
  ensureRequiredChecklistItems,
  getDepartmentChecklistTemplates,
  isRequiredChecklistItem,
  normalizeChecklistItems,
} from "../shiftChecklist.js";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("EGAIS receives its standard operational checklist", () => {
  const templates = getDepartmentChecklistTemplates("egais");
  assert.equal(templates.length, 9);
  assert.ok(templates.includes("Проверить суточные на отправку"));
  assert.ok(templates.includes("Принять дистиллят"));
  assert.deepEqual(getDepartmentChecklistTemplates("warehouse"), []);
});

test("EGAIS brand handover task is always present and canonical", () => {
  const items = ensureRequiredChecklistItems([
    { id: "legacy", text: "Покрутить марку для сменщика", done: true, source: "custom" },
    { id: "other", text: "Проверить суточные", done: false, source: "custom" },
  ], "egais");

  assert.equal(items.length, 2);
  assert.equal(items[0].text, EGAIS_REQUIRED_CHECKLIST_ITEM);
  assert.equal(items[0].done, true);
  assert.equal(items[0].source, "standard");
  assert.equal(isRequiredChecklistItem(items[0], "egais"), true);
  assert.equal(isRequiredChecklistItem(items[0], "warehouse"), false);
  assert.equal(ensureRequiredChecklistItems([], "egais")[0].text, EGAIS_REQUIRED_CHECKLIST_ITEM);
});

test("checklist items are normalized and progress is calculated", () => {
  const first = createChecklistItem("  Проверить   суточные  ", "standard");
  const items = normalizeChecklistItems([
    { ...first, done: true },
    { id: "second", text: "Передать смену", done: false, source: "custom" },
  ]);
  const progress = checklistProgress(items);

  assert.equal(items[0].text, "Проверить суточные");
  assert.deepEqual(progress, { total: 2, completed: 1, remaining: 1, percent: 50 });
});

test("database exposes checklists only through authenticated RPCs", async () => {
  const sql = await source("supabase-sql/032_shift_checklists.sql");

  assert.match(sql, /revoke all on table public\.shift_checklists from anon, authenticated/i);
  assert.match(sql, /unique index[\s\S]*where status = 'active'/i);
  assert.match(sql, /validate_shift_checklist_items/i);
  assert.match(sql, /grant execute on function public\.get_my_shift_checklist_state\(\) to authenticated/i);
  assert.match(sql, /завершенные записи не удаляются автоматически/i);
  assert.match(sql, /owner_shift_checklist_statistics/i);
  assert.match(sql, /if not public\.is_owner\(\)/i);
  assert.match(sql, /alter table public\.shift_checklists[\s\S]*add column if not exists department_name text/i);
  assert.doesNotMatch(sql, /grant (select|insert|update|delete)[\s\S]*shift_checklists[\s\S]*authenticated/i);
});

test("reminder function is protected and advances reminders by three hours", async () => {
  const [sql, edge] = await Promise.all([
    source("supabase-sql/032_shift_checklists.sql"),
    source("supabase/functions/send-shift-checklist-reminders/index.ts"),
  ]);

  assert.match(sql, /'\*\/15 \* \* \* \*'/);
  assert.match(sql, /x-cron-secret/i);
  assert.match(edge, /constantTimeEqual/);
  assert.match(edge, /INVALID_CRON_SECRET/);
  assert.match(edge, /3 \* 60 \* 60 \* 1000/);
  assert.match(edge, /shift_checklist_reminder/);
});

test("completed checklist notifies only the actual next shift", async () => {
  const [sql, client, edge] = await Promise.all([
    source("supabase-sql/034_shift_handover_notifications.sql"),
    source("checklist.js"),
    source("supabase/functions/send-push-notifications/index.ts"),
  ]);

  assert.match(sql, /v_handover_kind = 'day_to_night'[\s\S]*public\.is_night_shift_start\(hours\.day_hours, hours\.night_hours\)/i);
  assert.match(sql, /v_handover_kind = 'night_to_day'[\s\S]*hours\.day_hours > 0 and hours\.night_hours = 0/i);
  assert.match(sql, /v_schedule_date - 1/i);
  assert.match(sql, /p_night_hours[\s\S]*= 5[\s\S]*p_day_hours[\s\S]*in \(1, 2\)/i);
  assert.doesNotMatch(sql, /v_target_date := v_schedule_date \+ 1/i);
  assert.match(sql, /not public\.is_shift_handover_manager_position\(profile\.position\)/i);
  assert.match(sql, /v_row\.started_at >= now\(\) - interval '36 hours'/i);
  assert.match(sql, /existing\.created_at >= now\(\) - interval '10 hours'/i);
  assert.match(sql, /'handover_recipients', v_recipient_count/i);
  assert.match(sql, /revoke all on function public\.shift_hours_on_date\(uuid, date\) from public, anon, authenticated/i);
  assert.match(client, /type: "shift_handover_ready"/);
  assert.match(edge, /verifyShiftHandoverAccess/);
  assert.match(edge, /type === "shift_handover_ready"/);
});

test("server keeps the required EGAIS item and off-shift completion has no recipient", async () => {
  const [requiredSql, handoverSql] = await Promise.all([
    source("supabase-sql/037_required_egais_checklist_item.sql"),
    source("supabase-sql/034_shift_handover_notifications.sql"),
  ]);

  assert.match(requiredSql, /Покрутить марку сменщику/);
  assert.match(requiredSql, /new\.items := public\.ensure_required_shift_checklist_items/i);
  assert.match(requiredSql, /where department_key = 'egais'[\s\S]*status = 'active'/i);
  assert.match(handoverSql, /elsif v_outgoing_day > 0 and v_outgoing_night = 0/i);
  assert.match(handoverSql, /if v_handover_kind is not null then[\s\S]*insert into public\.user_notifications/i);
});
