import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  checklistProgress,
  createChecklistItem,
  getDepartmentChecklistTemplates,
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
