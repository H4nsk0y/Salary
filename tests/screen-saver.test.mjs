import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("settings link opens three screen saver modes", async () => {
  const [settings, page, script] = await Promise.all([
    read("settings.html"), read("screen-saver.html"), read("screen-saver.js"),
  ]);
  assert.match(settings, /href="screen-saver\.html"/);
  for (const mode of ["ribbons", "building", "orbit"]) {
    assert.match(page, new RegExp(`data-mode="${mode}"`));
  }
  assert.match(script, /requestAnimationFrame\(frame\)/);
  assert.match(script, /navigator\.wakeLock\.request\("screen"\)/);
  assert.match(script, /fullscreenchange/);
  assert.match(script, /is-idle/);
  assert.match(script, /app-icon-512\.png/);
  assert.match(script, /setPointerCapture/);
  assert.doesNotMatch(page, /id="wakeStatus"/);
});

test("shift reminder function is deployed through the source manifest", async () => {
  const source = await read("supabase/functions/send-shift-reminders/index.ts");
  assert.match(source, /const tonightNight = tonight\?\.kind === "night"/);
  assert.match(source, /today\.hour !== 17/);
});
