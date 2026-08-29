import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("ideas are submitted through a limited authenticated RPC", async () => {
  const sql = await source("supabase-sql/033_project_ideas.sql");

  assert.match(sql, /revoke all on table public\.project_ideas from anon, authenticated/i);
  assert.match(sql, /char_length\(v_text\) not between 10 and 2000/i);
  assert.match(sql, /created_at >= now\(\) - interval '24 hours'/i);
  assert.match(sql, /IDEA_RATE_LIMIT/i);
  assert.match(sql, /grant execute on function public\.submit_project_idea\(text\) to authenticated/i);
  assert.doesNotMatch(sql, /grant (select|insert|update|delete)[\s\S]*project_ideas[\s\S]*authenticated/i);
});

test("only owner can list ideas and change their status", async () => {
  const sql = await source("supabase-sql/033_project_ideas.sql");

  assert.match(sql, /owner_list_project_ideas[\s\S]*if not public\.is_owner\(\)/i);
  assert.match(sql, /owner_set_project_idea_status[\s\S]*if not public\.is_owner\(\)/i);
  assert.match(sql, /owner_delete_project_idea[\s\S]*if not public\.is_owner\(\)/i);
  assert.match(sql, /p_status not in \('new', 'reviewed', 'archived'\)/i);
  assert.match(sql, /revoke all on function public\.owner_list_project_ideas\(text\) from public, anon/i);
  assert.match(sql, /revoke all on function public\.owner_delete_project_idea\(bigint\) from public, anon/i);
});

test("idea UI renders user content as text instead of HTML", async () => {
  const page = await source("owner-ideas.js");
  const dialog = await source("ideaDialog.js");

  assert.match(page, /node\.textContent = String\(text\)/);
  assert.doesNotMatch(page, /innerHTML\s*=\s*row\./);
  assert.match(dialog, /maxlength="2000"/);
  assert.match(dialog, /rel="noopener noreferrer"/);
});

test("owner hub links to the idea inbox", async () => {
  assert.match(await source("owner.html"), /href="owner-ideas\.html"[\s\S]*Идеи/);
});

test("reviewing an idea creates one personal notification and requests push delivery", async () => {
  const [sql, page] = await Promise.all([
    source("supabase-sql/038_idea_review_notifications.sql"),
    source("owner-ideas.js"),
  ]);

  assert.match(sql, /p_status = 'reviewed' and v_idea\.status is distinct from 'reviewed'/i);
  assert.match(sql, /insert into public\.user_notifications/i);
  assert.match(sql, /'project_idea_reviewed'/);
  assert.match(sql, /v_idea\.user_id/);
  assert.match(page, /sendPushNotifications\(\{ type: "project_idea_reviewed", allUsers: true \}\)/);
});
