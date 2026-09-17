import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("home workspace contains the checklist and current product name", async () => {
  const html = await source("index.html");
  assert.match(html, /href="checklist\.html"[\s\S]*workspace-index">06[\s\S]*Чек-лист/);
  assert.match(html, /ALVISA SALARY/);
});

test("desktop navigation renders profile as an accessible icon", async () => {
  const script = await source("nav.js");
  assert.match(script, /variant === "desktop" && link\.key === "profile"/);
  assert.match(script, /classList\.add\("nav-profile-icon"\)/);
  assert.match(script, /a\.setAttribute\("aria-label", link\.label\)/);
  assert.match(script, /function createProfileIcon\(\)/);
  assert.match(script, /\[\.\.\.regularLinks, \.\.\.OWNER_LINKS, profileLink\]/);
  assert.match(script, /insertBefore\(renderLink\(link, activeKey, "desktop"\), desktopProfile \?\? null\)/);
});

test("schedule controls share a desktop baseline and legacy badge is gone", async () => {
  const html = await source("schedule.html");
  assert.match(html, /@media \(min-width: 768px\)[\s\S]*\.schedule-department-label[\s\S]*height: 42px/);
  assert.match(html, /\.schedule-control-button[\s\S]*align-self: center/);
  assert.doesNotMatch(html, />\s*График отдела\s*</);
});

test("schedule sends users with department access to the shared timesheet", async () => {
  const [html, script] = await Promise.all([source("schedule.html"), source("schedule.js")]);
  assert.match(html, /id="timesheetLink"[\s\S]*Мой табель/);
  assert.match(script, /timesheetLink\.textContent = "Табель отдела"/);
  assert.match(script, /admin\.html\?department=/);
  assert.match(script, /profile\?\.role === "owner"/);
  assert.match(script, /membershipDepartmentKey === "egais"/);
});

test("personal schedule notifications contain only the new state", async () => {
  const [script, sql] = await Promise.all([
    source("admin.js"),
    source("supabase-sql/039_compact_timesheet_change_notifications.sql"),
  ]);
  const collector = script.match(/function collectPersonalTimesheetChanges\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(script, /return `Ночь \$\{fmtHours\(day\)\}\/\$\{fmtHours\(night\)\}`/);
  assert.match(collector, /notificationCellLabel\(current, index\)/);
  assert.doesNotMatch(collector, /notificationCellLabel\(previous, index\)/);
  assert.doesNotMatch(collector, /→/);
  assert.match(sql, /'Ваш график изменился\.'/);
  assert.doesNotMatch(sql, /v_actor_name/);
});

test("help page no longer renders the old product badge", async () => {
  assert.doesNotMatch(await source("help.html"), />\s*Помощь по Alvisa\s*</i);
});

test("profile supports validated custom positions without changing membership", async () => {
  const [html, script] = await Promise.all([source("profile.html"), source("profile.js")]);
  assert.match(html, /option value="__custom__">Свой вариант/);
  assert.match(html, /Это не меняет ваш доступ и не добавляет вас в состав отдела/);
  assert.match(script, /isValidCustomPosition/);
  assert.match(script, /position === CUSTOM_POSITION_VALUE/);
  assert.match(script, /openIdeaDialog\(\{[\s\S]*Предлагаю добавить новый отдел/);
});

test("employment date is constrained inside the mobile profile grid", async () => {
  const html = await source("profile.html");
  assert.match(html, /#employmentDateInput \{[^}]*width: 100%[^}]*min-width: 0[^}]*max-width: 100%/);
  assert.match(html, /#employmentDateInput \{[^}]*min-inline-size: 0 !important/);
});

test("profile name separates patronymic and training achievement lives on the training page", async () => {
  const [profile, training, tour] = await Promise.all([
    source("profile.html"), source("timesheet-training.html"), source("tour.js"),
  ]);
  assert.match(profile, /id="displayNamePrimary"/);
  assert.match(profile, /id="displayNamePatronymic"/);
  assert.doesNotMatch(profile, /id="trainingAchievement"/);
  assert.match(training, /id="trainingAchievement"/);
  assert.match(tour, /element: "#profileTrainingLink"/);
});

test("one department invite can restore membership for an existing account", async () => {
  const [admin, login, sql] = await Promise.all([
    source("admin.html"), source("login.js"), source("supabase-sql/005_shift_overview_and_department_invites.sql"),
  ]);
  assert.match(admin, /Одна ссылка подходит и новым, и уже зарегистрированным сотрудникам/);
  assert.match(login, /if \(session\) \{\s*await acceptPendingInvite\(\)/);
  assert.match(login, /await signIn\(email, password\);\s*const inviteResult = await acceptPendingInvite\(\)/);
  assert.match(sql, /insert into public\.department_members \(department_key, user_id\)/);
  assert.match(sql, /on conflict do nothing;/);
});

test("mobile profile puts status opposite the action icons", async () => {
  const html = await source("profile.html");
  assert.match(html, /@media \(max-width: 639px\) \{\s*\.profile-header-controls \{[^}]*flex-direction: row;[^}]*justify-content: space-between;/);
  assert.match(html, /\.profile-header-controls \.profile-actions \{[^}]*order: 0;[^}]*justify-content: flex-start;/);
  assert.match(html, /\.profile-status-wrap \{[^}]*order: 1;[^}]*justify-content: flex-end;/);
  assert.match(html, /class="profile-status-wrap flex items-center gap-2 text-xs"/);
});

test("personal timesheet offers classic, calendar and agenda views", async () => {
  const [html, script] = await Promise.all([source("table.html"), source("table.js")]);
  assert.match(html, /data-timesheet-view-button="classic"[^>]*>Классический</);
  assert.match(html, /data-timesheet-view-button="calendar"[^>]*>Календарь</);
  assert.match(html, /data-timesheet-view-button="agenda"[^>]*>Лента</);
  assert.match(html, /id="timesheetDayEditor"/);
  assert.match(script, /TIMESHEET_VIEW_STORAGE_KEY/);
  assert.match(script, /renderCalendarTimesheet/);
  assert.match(script, /renderAgendaTimesheet/);
  assert.match(script, /source\.dispatchEvent\(new Event\("input"/);
  assert.match(script, /Только дни с часами/);
  assert.match(script, /syncClassicFilterState/);
});

test("department timesheet shows day and night totals for both periods", async () => {
  const script = await source("admin.js");
  assert.match(script, /<span>Норма месяца<\/span>[\s\S]*<span>Отработал<\/span>/);
  assert.match(script, /День \/ ночь \(1–15\)/);
  assert.match(script, /День \/ ночь \(месяц\)/);
  assert.match(script, /const dayFH = sumRange\(state\.dayHours, 0, endIdx\)/);
  assert.match(script, /const nightFH = sumRange\(state\.nightHours, 0, endIdx\)/);
  assert.doesNotMatch(script, /ОТ \/ Б \/ НТ \/ проч\./);
});

test("latest user update is announced once until the updates page is opened", async () => {
  const [updates, nav] = await Promise.all([source("updates.html"), source("nav.js")]);
  assert.match(updates, /Обновление 31\.0/);
  assert.match(updates, /Напоминания о ближайшей смене/);
  assert.doesNotMatch(updates, /Учебный табель|учебном табеле/i);
  assert.match(nav, /CURRENT_UPDATES_VERSION = "33\.0"/);
  assert.match(nav, /UPDATES_SEEN_STORAGE_KEY/);
  assert.match(nav, /scheduleUnreadUpdatesPrompt/);
  assert.match(nav, /markCurrentUpdatesSeen/);
});

test("owner analytics links each comparable record to the employee timesheet", async () => {
  const [html, script] = await Promise.all([source("owner-analytics.html"), source("owner-analytics.js")]);
  assert.match(html, /<th>Действия<\/th>/);
  assert.match(script, /employee: String\(row\.user_id\)/);
  assert.match(script, /link\.textContent = "Табель"/);
});

test("EGAIS reminder setting uses the concise audience label", async () => {
  const html = await source("settings.html");
  assert.match(html, />\s*Уведомлять о проверках суточных файлов\s*</);
  assert.match(html, />\s*Для сотрудников ЕГАИС\s*</);
});
