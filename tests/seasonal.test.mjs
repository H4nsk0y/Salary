import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import test from "node:test";
import { FESTIVE_START, FESTIVE_END, isFestiveSeason, isLocalFestivePreview } from "../js/features/festiveBootstrap.js";

const root = new URL("../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");

test("early preview is available only on loopback and persists within a tab", () => {
  assert.equal(isLocalFestivePreview("http://127.0.0.1:5500/index.html?festive-preview=1"), true);
  assert.equal(isLocalFestivePreview("http://localhost:5500/profile.html", true), true);
  assert.equal(isLocalFestivePreview("http://[::1]:5500/?festive-preview=1"), true);
  assert.equal(isLocalFestivePreview("http://localhost/?festive-preview=0", true), false);
  assert.equal(isLocalFestivePreview("http://localhost/"), false);
  for (const host of ["h4nsk0y.ru", "localhost.example.com", "127.0.0.1.example.com"]) {
    assert.equal(isLocalFestivePreview(`https://${host}/?festive-preview=1`, true), false);
  }
  assert.equal(isLocalFestivePreview("file:///index.html?festive-preview=1", true), false);
});

test("festive window is bounded by Moscow midnight, not browser timezone", () => {
  assert.equal(isFestiveSeason(Date.parse("2026-11-22T12:00:00+03:00")), false);
  assert.equal(isFestiveSeason(FESTIVE_START - 1), false);
  assert.equal(isFestiveSeason(FESTIVE_START), true);
  assert.equal(isFestiveSeason(FESTIVE_END - 1), true);
  assert.equal(isFestiveSeason(FESTIVE_END), false);
  assert.equal(isFestiveSeason(Date.parse("2027-12-20T00:00:00+03:00")), false);
});

test("every application page reaches the seasonal bootstrap", () => {
  for (const file of readdirSync(root).filter(name => name.endsWith(".html"))) {
    if (file === "offline.html") continue;
    assert.match(read(file), /js\/pageLoaderBoot\.js/, file);
  }
  assert.match(read("js/pageLoaderBoot.js"), /import\("\.\/features\/festiveBootstrap\.js"\)/);
  assert.match(read("js/offline.js"), /import "\.\/features\/festiveBootstrap\.js"/);
  assert.ok(statSync(new URL("media/festive-new-year.mp3", root)).size > 1_000_000);
});

test("technical retention never deletes application data or running jobs", () => {
  const sql = read("supabase-sql/080_cron_history_retention.sql");
  assert.match(sql, /status = 'succeeded' and end_time < now\(\) - interval '7 days'/);
  assert.match(sql, /status = 'failed' and end_time < now\(\) - interval '30 days'/);
  assert.match(sql, /cron\.schedule\('alvisa-cron-history-retention'/);
  assert.doesNotMatch(sql, /delete from public\.|truncate|drop /i);
});
