import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("home workspace links to the checklist and screen saver in order", async () => {
  const html = await source("index.html");
  assert.match(html, /href="checklist\.html"[^>]*>\s*<span class="workspace-index">05<\/span>[\s\S]*?class="workspace-title">Чек-лист/);
  assert.match(html, /href="screen-saver\.html\?mode=building&amp;from=index\.html"[^>]*>\s*<span class="workspace-index">06<\/span>[\s\S]*?class="workspace-title">Негаснущий экран/);
  assert.match(html, /ALVISA SALARY/);
});

test("desktop navigation renders profile as an accessible icon", async () => {
  const script = await source("js/nav.js");
  assert.match(script, /variant === "desktop" && link\.key === "profile"/);
  assert.match(script, /classList\.add\("nav-profile-icon"\)/);
  assert.match(script, /a\.setAttribute\("aria-label", link\.label\)/);
  assert.match(script, /function createProfileIcon\(\)/);
  assert.match(script, /\[\.\.\.regularLinks, \.\.\.OWNER_LINKS, profileLink\]/);
  assert.match(script, /insertBefore\(desktopLink, desktopProfile \?\? null\)/);
  assert.match(script, /insertBefore\(mobileLink, mobileProfile \?\? null\)/);
});

test("schedule controls share a desktop baseline and legacy badge is gone", async () => {
  const html = await source("schedule.html");
  assert.match(html, /@media \(min-width: 768px\)[\s\S]*\.schedule-department-label[\s\S]*height: 42px/);
  assert.match(html, /\.schedule-control-button[\s\S]*align-self: center/);
  assert.doesNotMatch(html, />\s*График отдела\s*</);
});

test("schedule sends users with department access to the shared timesheet", async () => {
  const [html, script] = await Promise.all([source("schedule.html"), source("js/schedule.js")]);
  assert.match(html, /id="timesheetLink"[\s\S]*Мой табель/);
  assert.match(script, /timesheetLink\.textContent = "Табель отдела"/);
  assert.match(script, /admin\.html\?department=/);
  assert.match(script, /profile\?\.role === "owner"/);
  assert.match(script, /managedDepartment\?\.key/);
  assert.doesNotMatch(script, /membershipDepartmentKey === "egais"/);
});

test("personal schedule notifications contain only the new state", async () => {
  const [script, sql] = await Promise.all([
    source("js/admin.js"),
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

test("profile offers position proposals separately from the department's approved positions", async () => {
  const [html, script] = await Promise.all([source("profile.html"), source("js/profile.js")]);
  assert.match(html, /id="suggestPositionBtn"[^>]*>Предложить должность/);
  assert.match(html, /в профиле она автоматически не изменится/);
  assert.match(script, /validateCustomPositionSelection/);
  assert.match(script, /submitDepartmentPositionProposal\(result\.department, result\.position\)/);
  assert.match(script, /openIdeaDialog\(\{[\s\S]*Предлагаю добавить новый отдел/);
});

test("employment date is constrained inside the mobile profile grid", async () => {
  const styles = await source("styles/pages/profile.css");
  assert.match(styles, /#employmentDateInput \{[^}]*width: 100%[^}]*min-width: 0[^}]*max-width: 100%/);
  assert.match(styles, /#employmentDateInput \{[^}]*min-inline-size: 0 !important/);
});

test("profile name separates patronymic and training achievement lives on the training page", async () => {
  const [profile, training, tour] = await Promise.all([
    source("profile.html"), source("timesheet-training.html"), source("js/tour.js"),
  ]);
  assert.match(profile, /id="displayNamePrimary"/);
  assert.match(profile, /id="displayNamePatronymic"/);
  assert.doesNotMatch(profile, /id="trainingAchievement"/);
  assert.match(training, /id="trainingAchievement"/);
  assert.match(tour, /element: "#profileTrainingLink"/);
});

test("one department invite can restore membership for an existing account", async () => {
  const [admin, login, sql] = await Promise.all([
    source("admin.html"), source("js/login.js"), source("supabase-sql/005_shift_overview_and_department_invites.sql"),
  ]);
  assert.match(admin, /Одна ссылка подходит и новым, и уже зарегистрированным сотрудникам/);
  assert.match(login, /if \(session\) \{\s*await acceptPendingInvite\(\)/);
  assert.match(login, /await signIn\(email, password\);\s*const inviteResult = await acceptPendingInvite\(\)/);
  assert.match(sql, /insert into public\.department_members \(department_key, user_id\)/);
  assert.match(sql, /on conflict do nothing;/);
});

test("mobile profile puts status opposite the action icons", async () => {
  const [html, styles] = await Promise.all([source("profile.html"), source("styles/pages/profile.css")]);
  assert.match(styles, /@media \(max-width: 639px\) \{\s*\.profile-header-controls \{[^}]*flex-direction: row;[^}]*justify-content: space-between;/);
  assert.match(styles, /\.profile-header-controls \.profile-actions \{[^}]*order: 0;[^}]*justify-content: flex-start;/);
  assert.match(styles, /\.profile-status-wrap \{[^}]*order: 1;[^}]*justify-content: flex-end;/);
  assert.match(html, /class="profile-status-wrap flex items-center gap-2 text-xs"/);
});

test("personal timesheet offers classic, calendar and agenda views", async () => {
  const [html, script] = await Promise.all([source("table.html"), source("js/table.js")]);
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
  const script = await source("js/admin.js");
  assert.match(script, /<span>Норма месяца<\/span>[\s\S]*<span>Отработал<\/span>/);
  assert.match(script, /День \/ ночь \(1–15\)/);
  assert.match(script, /День \/ ночь \(месяц\)/);
  assert.match(script, /const dayFH = sumRange\(state\.dayHours, 0, endIdx\)/);
  assert.match(script, /const nightFH = sumRange\(state\.nightHours, 0, endIdx\)/);
  assert.doesNotMatch(script, /ОТ \/ Б \/ НТ \/ проч\./);
});

test("updates remain user-controlled without automatic modal prompts", async () => {
  const [updates, nav] = await Promise.all([source("updates.html"), source("js/nav.js")]);
  assert.match(updates, /Обновление 35\.0/);
  assert.match(updates, /Контрактное производство «Одиссей»/);
  assert.match(updates, /АЛВИСА ШАТО/);
  assert.match(updates, /АЛВИСА ОДИССЕЙ/);
  assert.doesNotMatch(updates, /Учебный табель|учебном табеле/i);
  assert.doesNotMatch(nav, /CURRENT_UPDATES_VERSION|UPDATES_SEEN_STORAGE_KEY/);
  assert.doesNotMatch(nav, /scheduleUnreadUpdatesPrompt|markCurrentUpdatesSeen/);
});

test("owner analytics links each comparable record to the employee timesheet", async () => {
  const [html, script] = await Promise.all([source("owner-analytics.html"), source("js/owner-analytics.js")]);
  assert.match(html, /<th>Действия<\/th>/);
  assert.match(script, /employee: String\(row\.user_id\)/);
  assert.match(script, /link\.textContent = "Табель"/);
});

test("EGAIS reminder setting names the audience and account-wide scope", async () => {
  const html = await source("settings.html");
  assert.match(html, />\s*Уведомлять о проверках суточных файлов\s*</);
  assert.match(html, />\s*Для сотрудников ЕГАИС · на всех устройствах аккаунта\s*</);
});
