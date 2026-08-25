import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const removedFiles = [
  "chat.html",
  "chat.js",
  "tasks.html",
  "tasks.js",
  "voting.html",
  "voting.js",
  "instructions.html",
  "instructions.js",
  "files/egais-pallet-fix.pdf",
  "support-game.js",
  "excelExport.js",
  "audio/easter-boss-theme.mp3",
  "templates/tabel-template.xlsx",
  "templates/tabel-template_31.xlsx",
];

test("retired feature files are removed", () => {
  for (const path of removedFiles) {
    assert.equal(existsSync(new URL(path, root)), false, `${path} should not exist`);
  }
});

test("retired features are absent from active entry points and data helpers", () => {
  for (const path of ["nav.js", "index.html", "manifest.webmanifest", "db.js"]) {
    const source = read(path);
    assert.doesNotMatch(source, /(?:chat|tasks|voting|instructions)\.html/i);
    assert.doesNotMatch(source, /department_messages|department_tasks|staff_votes/i);
  }
});

test("database cleanup removes retired tables, functions and notifications", () => {
  const sql = read("supabase-sql/036_remove_unused_features.sql");

  assert.match(sql, /drop table if exists public\.department_messages/i);
  assert.match(sql, /drop table if exists public\.department_tasks/i);
  assert.match(sql, /drop table if exists public\.staff_votes/i);
  assert.match(sql, /drop table if exists public\.easter_runner_scores/i);
  assert.match(sql, /cron\.unschedule/i);
  assert.match(sql, /delete from public\.user_notifications/i);
});
