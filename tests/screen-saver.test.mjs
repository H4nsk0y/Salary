import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { buildIdleScreenSaverUrl } from "../js/idleScreenSaver.js";

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("settings link opens screen saver modes", async () => {
  const [settings, page, script, shortcuts] = await Promise.all([
    read("settings.html"), read("screen-saver.html"), read("js/screen-saver.js"),
    read("js/features/fullscreenShortcuts.js"),
  ]);
  assert.match(settings, /href="screen-saver\.html"/);
  for (const mode of ["ribbons", "building", "orbit", "shift", "map"]) {
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
  assert.match(script, /listDepartmentShiftOverview/);
  assert.match(script, /getMyShiftChecklistState/);
  assert.match(script, /listDepartmentActiveChecklists/);
  assert.match(page, /id="shiftBoard"/);
  assert.match(page, /id="enterpriseMap"/);
  assert.doesNotMatch(page, /id="wakeStatus"/);
});

test("home page exposes the building screen saver to guests", async () => {
  const home = await read("index.html");
  assert.match(home, /href="screen-saver\.html\?mode=building&amp;from=index\.html"[\s\S]*Не отключать экран/);
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
  const idle = await read("js/idleScreenSaver.js");
  assert.match(idle, /event\?\.isTrusted === false/);
  assert.doesNotMatch(idle, /"scroll"/);
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

test("live shift checklist summary is scoped by an authenticated department RPC", async () => {
  const [sql, db] = await Promise.all([
    read("supabase-sql/058_live_shift_checklists.sql"),
    read("js/db.js"),
  ]);
  assert.match(sql, /auth\.uid\(\)/);
  assert.match(sql, /member\.department_key = v_department_key/);
  assert.match(sql, /checklist\.started_at >= now\(\) - interval '36 hours'/);
  assert.match(sql, /revoke all on function public\.list_department_active_checklists\(\) from public, anon/i);
  assert.match(db, /supabase\.rpc\("list_department_active_checklists"\)/);
});

test("enterprise map exposes live totals and building workers to authenticated users", async () => {
  const [sql, db, page, script, scene] = await Promise.all([
    read("supabase-sql/059_enterprise_live_map.sql"),
    read("js/db.js"),
    read("screen-saver.html"),
    read("js/screen-saver.js"),
    read("js/enterpriseMap3d.js"),
  ]);
  assert.match(sql, /auth\.uid\(\) is null/);
  assert.match(sql, /count\(\*\) filter \(where source\.on_shift\)/);
  assert.match(sql, /revoke all on function public\.list_enterprise_live_map\(\) from public, anon/i);
  assert.match(sql, /revoke all on function public\.list_enterprise_live_workers\(text\) from public, anon/i);
  assert.match(sql, /p\.branch = 'contract_odyssey'/);
  assert.match(db, /supabase\.rpc\("list_enterprise_live_map"\)/);
  assert.match(db, /supabase\.rpc\("list_enterprise_live_workers"/);
  assert.match(page, /data-mode="map"/);
  assert.match(page, /id="enterpriseMapCanvas"/);
  assert.match(page, /id="enterpriseMapInside"/);
  assert.match(script, /setInterval\([\s\S]*loadEnterpriseMap[\s\S]*60000/);
  assert.match(script, /focusBuilding\(buildingId\)/);
  assert.match(script, /enterProductionInterior\(\)/);
  assert.match(script, /enterProductionSecondFloor\(\)/);
  assert.match(script, /focusDepartment\(areaId\)/);
  assert.match(script, /buildingRows\.filter/);
  assert.match(page, /id="enterpriseMapCoverageToggle"/);
  assert.match(page, /id="enterpriseMapCoverageLegend"/);
  assert.match(script, /buildEnterpriseStaffing/);
  assert.match(scene, /setStaffingState/);
  assert.match(scene, /from "\.\.\/vendor\/three\/three\.module\.min\.js"/);
  assert.match(scene, /Raycaster/);
  assert.match(scene, /is-hovered/);
  assert.match(scene, /PRODUCTION_AREAS/);
  assert.match(scene, /SECOND_FLOOR_AREAS/);
  assert.match(scene, /Склад готовой продукции/);
  assert.match(scene, /Кабинет ЕГАИС/);
  assert.match(scene, /createSwitchbackStairs/);
  assert.match(scene, /enterProductionInterior/);
  assert.match(scene, /duration:1450|1450/);
});
