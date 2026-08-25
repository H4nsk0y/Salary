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

test("schedule controls share a desktop baseline and legacy badge is gone", async () => {
  const html = await source("schedule.html");
  assert.match(html, /@media \(min-width: 768px\)[\s\S]*\.schedule-department-label[\s\S]*height: 42px/);
  assert.match(html, /\.schedule-control-button[\s\S]*align-self: center/);
  assert.doesNotMatch(html, />\s*График отдела\s*</);
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

test("latest user update is announced once until the updates page is opened", async () => {
  const [updates, nav] = await Promise.all([source("updates.html"), source("nav.js")]);
  assert.match(updates, /Обновление 29\.0/);
  assert.match(updates, /ALVISA SALARY стал легче/);
  assert.match(nav, /CURRENT_UPDATES_VERSION = "29\.0"/);
  assert.match(nav, /UPDATES_SEEN_STORAGE_KEY/);
  assert.match(nav, /scheduleUnreadUpdatesPrompt/);
  assert.match(nav, /markCurrentUpdatesSeen/);
});
