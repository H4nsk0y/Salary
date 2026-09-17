import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildIdleScreenSaverUrl } from "../idleScreenSaver.js";

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("settings link opens three screen saver modes", async () => {
  const [settings, page, script, shortcuts] = await Promise.all([
    read("settings.html"), read("screen-saver.html"), read("screen-saver.js"),
    read("features/fullscreenShortcuts.js"),
  ]);
  assert.match(settings, /href="screen-saver\.html"/);
  for (const mode of ["ribbons", "building", "orbit"]) {
    assert.match(page, new RegExp(`data-mode="${mode}"`));
  }
  assert.match(page, /href="profile\.html">В профиль<\/a>/);
  assert.match(script, /requestAnimationFrame\(frame\)/);
  assert.match(script, /navigator\.wakeLock\.request\("screen"\)/);
  assert.match(script, /fullscreenchange/);
  assert.match(script, /installDoubleRightClickFullscreen/);
  assert.match(shortcuts, /window\.addEventListener\("contextmenu"/);
  assert.match(shortcuts, /isDoubleRightClick/);
  assert.match(shortcuts, /document\.exitFullscreen\(\)/);
  assert.match(script, /is-idle/);
  assert.match(script, /5000/);
  assert.match(page, /body\.is-idle \.controls[^{]*\{[^}]*pointer-events: none/);
  assert.doesNotMatch(page, /body\.is-idle \.controls:not\(:focus-within\)/);
  assert.match(script, /app-icon-512\.png/);
  assert.match(script, /setPointerCapture/);
  assert.doesNotMatch(page, /id="wakeStatus"/);
});

test("shift reminder function is deployed through the source manifest", async () => {
  const source = await read("supabase/functions/send-shift-reminders/index.ts");
  assert.match(source, /const tonightNight = tonight\?\.kind === "night"/);
  assert.match(source, /today\.hour !== 17/);
  assert.match(source, /не забудьте заполнить чек-лист/);
});

test("idle screen saver preserves the return page and selects the building", async () => {
  const target = new URL(buildIdleScreenSaverUrl("https://h4nsk0y.ru/admin.html?department=egais"));
  assert.equal(target.pathname, "/screen-saver.html");
  assert.equal(target.searchParams.get("mode"), "building");
  assert.equal(target.searchParams.get("from"), "/admin.html?department=egais");
  const [nav, script] = await Promise.all([read("nav.js"), read("screen-saver.js")]);
  assert.match(nav, /if \(profile\?\.user_id\) \{[\s\S]*startIdleScreenSaver\(\)/);
  assert.match(script, /returnUrl\.origin === location\.origin/);
});
