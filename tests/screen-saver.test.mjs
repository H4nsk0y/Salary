import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { buildIdleScreenSaverUrl } from "../js/idleScreenSaver.js";

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("settings link opens three screen saver modes", async () => {
  const [settings, page, script, shortcuts] = await Promise.all([
    read("settings.html"), read("screen-saver.html"), read("js/screen-saver.js"),
    read("js/features/fullscreenShortcuts.js"),
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
  const [nav, script] = await Promise.all([read("js/nav.js"), read("js/screen-saver.js")]);
  assert.match(nav, /if \(profile\?\.user_id\) \{[\s\S]*startIdleScreenSaver\(\)/);
  assert.match(script, /returnUrl\.origin === location\.origin/);
});

test("screen saver music loops and follows the user across application pages", async () => {
  const [page, script, controller, nav, worker, track] = await Promise.all([
    read("screen-saver.html"),
    read("js/screen-saver.js"),
    read("js/backgroundMusic.js"),
    read("js/nav.js"),
    read("service-worker.js"),
    stat(new URL("../media/almost-here.mp3", import.meta.url)),
  ]);

  assert.ok(track.size > 1_000_000);
  assert.match(page, /id="musicToggleBtn"/);
  assert.match(page, /class="music-note"[^>]*>♪</);
  assert.match(script, /toggleBackgroundMusic\(\)/);
  assert.match(script, /alvisa:background-music-change/);
  assert.match(controller, /new Audio\(TRACK_URL\)/);
  assert.match(controller, /audio\.loop = true/);
  assert.match(controller, /MUSIC_POSITION_KEY/);
  assert.match(controller, /localStorage\.setItem\(MUSIC_ENABLED_KEY/);
  assert.match(nav, /import "\.\/backgroundMusic\.js"/);
  assert.match(worker, /"audio"/);
});
