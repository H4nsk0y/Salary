import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("admin schedule tools are initialized only for editors and owners", () => {
  const admin = read("../js/admin.js");
  const html = read("../admin.html");
  assert.match(admin, /function setupScheduleTools\(\)\s*\{\s*if \(departmentViewOnly\) return;/);
  assert.match(admin, /initAdminScheduleTools\(/);
  assert.match(admin, /scheduleSave\(\{ state \}\)/);
  assert.match(html, /id="scheduleToolButtons"[^>]*\bhidden\b/);
  assert.match(html, /id="scheduleLabLink"[^>]*\bhidden\b/);
});

test("cycle preview stays compact and the modal body scrolls within a fixed height", () => {
  const tools = read("../js/features/adminScheduleTools.js");
  const styles = read("../styles/pages/admin.css");
  assert.match(tools, /if \(activeTool === "fillNorm" \|\| activeTool === "reduceOvertime"\) \{\s*if \(plan\.changes\.length\) lines\.push\(formatScheduleChangeReport/);
  assert.match(tools, /cycleStartIndex = coverage\.startIndex/);
  assert.match(tools, /Переход на 2\/2 с/);
  assert.match(tools, /document\.body\.appendChild\(modal\)/);
  assert.match(styles, /\.schedule-tools-dialog \{[^}]*height: min\(680px, calc\(100dvh - 32px\)\)/);
  assert.match(styles, /\.schedule-tools-body \{[^}]*overflow: auto/);
  assert.match(styles, /\.schedule-tools-head, \.schedule-tools-foot \{[^}]*flex-shrink: 0/);
});

test("tool changes highlight only affected day or night cells until table reload", () => {
  const admin = read("../js/admin.js");
  const styles = read("../styles/pages/admin.css");
  assert.match(admin, /applyChanges: \(plans, tool\)/);
  assert.match(admin, /highlightChanges = tool === "fillNorm" \|\| tool === "reduceOvertime" \|\| tool === "bottling"/);
  assert.match(admin, /Number\(from\.dayHours\) !== Number\(to\.dayHours\)[\s\S]*?dayInput\?\.closest\("td"\)\?\.classList\.add\("schedule-tool-changed"\)/);
  assert.match(admin, /Number\(from\.nightHours\) !== Number\(to\.nightHours\)[\s\S]*?nightInput\?\.closest\("td"\)\?\.classList\.add\("schedule-tool-changed"\)/);
  assert.match(styles, /td\.schedule-tool-changed \.input-hour/);
});

test("bottling tool is offered in both the admin table and isolated owner lab", () => {
  const admin = read("../admin.html");
  const lab = read("../schedule-lab.html");
  const tools = read("../js/features/adminScheduleTools.js");
  assert.match(admin, /data-schedule-tool="bottling"/);
  assert.match(lab, /data-tool="bottling"/);
  assert.match(tools, /planBottlingSchedule\(/);
  assert.match(tools, /holiday: context\.holiday/);
});

test("employee selection uses full-row labels and larger themed checkboxes", () => {
  const tools = read("../js/features/adminScheduleTools.js");
  const styles = read("../styles/pages/admin.css");
  assert.match(tools, /row = document\.createElement\("label"\)/);
  assert.match(styles, /\.schedule-tools-person input\[type="checkbox"\] \{[^}]*width: 26px; height: 26px/);
  assert.match(styles, /\.schedule-tools-person:has\(input:checked\)/);
  assert.match(styles, /\.schedule-tools-option input \{[^}]*width: 26px; height: 26px/);
});

test("warehouse staffing controls apply to bottling and both continuous cycles", () => {
  const tools = read("../js/features/adminScheduleTools.js");
  const html = read("../admin.html");
  assert.match(tools, /tool === "bottling" \|\| Boolean\(SHIFT_CYCLES\[tool\]\)/);
  assert.match(tools, /enforceDayCoverage\(/);
  assert.match(tools, /minimum: 3/);
  assert.match(tools, /boosted: 5/);
  assert.match(html, /id="scheduleToolsTwoLines"/);
  assert.match(html, /Планируется розлив 2-ух линий\?/);
});

test("owner-managed night restrictions are protected and reach every automatic planner", () => {
  const migration = read("../supabase-sql/049_night_shift_restrictions.sql");
  const users = read("../js/owner-users.js");
  const admin = read("../js/admin.js");
  const tools = read("../js/features/adminScheduleTools.js");
  const lab = read("../js/features/scheduleLab.js");
  assert.match(migration, /create table if not exists public\.user_schedule_constraints/);
  assert.match(migration, /owner_set_user_night_shift_restriction/);
  assert.match(migration, /if auth\.uid\(\) is null or not public\.is_owner\(\)/);
  assert.match(migration, /revoke all on table public\.user_schedule_constraints from public, anon, authenticated/);
  assert.match(users, /Запретить ночные смены/);
  assert.match(admin, /listManagedDepartmentNightShiftRestrictions/);
  assert.match(tools, /noNight: context\.noNightShiftUserIds/);
  assert.match(lab, /Только день/);
});

test("personal norms feed automatic tools while generated shifts stay full length", () => {
  const admin = read("../js/admin.js");
  const values = read("../js/features/timesheetValues.js");
  assert.match(values, /normalizeWeeklyHours\(weeklyHours\) === REDUCED_WEEKLY_HOURS/);
  assert.match(values, /gender === "female" && branch === CHATEAU_ALVISA_BRANCH/);
  assert.match(admin, /personalNorm: \(state\) => personalNormHours\(state\)\.personalNorm/);
});

test("admin icon buttons show only the lower custom tooltip", () => {
  const html = read("../admin.html");
  const styles = read("../styles/pages/admin.css");
  const icons = [...html.matchAll(/<(?:button|a)\b[^>]*class="[^"]*admin-icon-action[^"]*"[^>]*>/g)].map(([tag]) => tag);
  assert.ok(icons.length >= 10);
  assert.ok(icons.every((tag) => !/\btitle=/.test(tag)));
  assert.match(styles, /\.admin-icon-action::after \{[^}]*top: calc\(100% \+ 9px\)/);
});

test("desktop employee labels put patronymic below surname and name without the day/night caption", () => {
  const admin = read("../js/admin.js");
  const styles = read("../styles/pages/admin.css");
  assert.match(admin, /nameParts\.slice\(0, 2\)\.join\(" "\)/);
  assert.match(admin, /patronymic\.textContent = nameParts\.length >= 3/);
  assert.doesNotMatch(admin, /sub\.textContent = "День \/ Ночь"/);
  assert.match(styles, /\.admin-matrix td \{\s*height: 44px/);
});

test("owner lab is isolated from timesheet database writes", () => {
  const lab = read("../js/features/scheduleLab.js");
  const html = read("../schedule-lab.html");
  assert.match(lab, /profile\?\.role !== "owner"/);
  assert.doesNotMatch(lab, /managedSave|saveTimesheet|\.from\("timesheets"\)/);
  assert.match(html, /id="labShell" hidden/);
  assert.match(html, /features\/scheduleLab\.js/);
});

test("mobile bundle includes feature modules used by the new pages", () => {
  const build = read("../scripts/build-mobile.mjs");
  assert.match(build, /copiedDirectories\s*=\s*\[[^\]]*"js"/);
});

test("leader controls require owner confirmation and keep manual editor rights distinct", () => {
  const migration = read("../supabase-sql/047_department_leaders.sql");
  const users = read("../js/owner-users.js");
  const lab = read("../js/features/scheduleLab.js");
  assert.match(migration, /if auth\.uid\(\) is null or not public\.is_owner\(\)/);
  assert.match(migration, /where is_leader/);
  assert.match(migration, /is_manual_editor/);
  assert.match(migration, /DEPARTMENT_LEADER_POSITION_RESERVED/);
  assert.match(users, /ownerSetDepartmentLeader/);
  assert.match(users, /Посмотреть UID/);
  assert.doesNotMatch(lab, /phaseA|phaseB|Группа А|Группа Б/);
  assert.match(lab, /person\.isLeader/);
});
