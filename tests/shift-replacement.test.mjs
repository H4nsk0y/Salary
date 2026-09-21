import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("replacement lookup is read-only and limited to the caller's department", async () => {
  const [sql, db] = await Promise.all([
    read("supabase-sql/054_shift_replacement_candidates.sql"),
    read("js/db.js"),
  ]);

  assert.match(sql, /auth\.uid\(\)/);
  assert.match(sql, /member\.department_key = v_department_key/);
  assert.match(sql, /member\.user_id <> v_user_id/);
  assert.match(sql, /SHIFT_NOT_SCHEDULED/);
  assert.doesNotMatch(sql, /update public\.timesheets/i);
  assert.doesNotMatch(sql, /insert into public\.timesheets/i);
  assert.match(db, /find_my_shift_replacement_candidates/);
});

test("replacement lookup prioritizes days off and treats recovery as a night fallback", async () => {
  const [sql, table, html] = await Promise.all([
    read("supabase-sql/054_shift_replacement_candidates.sql"),
    read("js/table.js"),
    read("table.html"),
  ]);

  assert.match(sql, /v_shift_type = 'night'/);
  assert.match(sql, /state\.night_hours = 5/);
  assert.match(sql, /state\.day_hours in \(1, 2\)/);
  assert.match(sql, /not state\.no_night_shifts/);
  assert.match(sql, /editor\.is_leader/);
  assert.match(table, /findSelectedShiftReplacement/);
  assert.match(html, /Табель и смены автоматически не изменяются|справочный характер/);
  assert.match(html, /id="findReplacementBtn"/);
  assert.match(html, /id="shiftReplacementOverlay"/);
});
