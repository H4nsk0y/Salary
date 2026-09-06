import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";
import { computePaymentSplit, computeSalary } from "../calc.js";
import { createSerialTaskQueue } from "../asyncTasks.js";
import {
  getProductionCalendarMonth,
  mergeProductionCalendarDefaults,
} from "../productionCalendar.js";
import {
  hardenTimesheetInput,
  rejectUnexpectedTimesheetAutofill,
  restoreUnfocusedNumericInput,
} from "../timesheetInput.js";

// Run actual page functions with a small DOM/database boundary, without production access.
async function pageFunction(file, name) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
  assert.ok(match, name);
  return match[0];
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("hourly rates change with month norm, including the night supplement", () => {
  const july = computeSalary({ oklad: 50000, normHours: 184, workedHours: 160, nightHours: 24 });
  const september = computeSalary({ oklad: 50000, normHours: 176, workedHours: 160, nightHours: 24 });
  assert.ok(july.ok && september.ok);
  assert.ok(september.result.hourRate > july.result.hourRate);
  assert.ok(september.result.nightExtra > july.result.nightExtra);
  assert.ok(Math.abs(july.result.hourRate - 50000 * 1.35 * 0.87 / 184) < 1e-9);
  assert.ok(Math.abs(september.result.net - (50000 / 176 * (160 * 1.35 + 24 * 0.4)) * 0.87) < 1e-9);
});

test("salary rejects infinite, missing and nonnumeric inputs", () => {
  for (const field of ["oklad", "normHours", "workedHours", "nightHours"]) {
    for (const value of [Infinity, -Infinity, NaN, "8", null, undefined]) {
      assert.equal(computeSalary({ oklad: 50000, normHours: 176, workedHours: 160, nightHours: 24, [field]: value }).ok, false);
    }
  }
  assert.equal(computeSalary(null).ok, false);
  assert.equal(computeSalary({ oklad: 50000, normHours: 176, workedHours: 2, nightHours: 3 }).ok, false);
});

test("annual overtime limit remains 120 hours without an enterprise agreement", async () => {
  const context = vm.createContext({ OVERTIME_LIMIT_DEFAULT_YEAR: 120 });
  vm.runInContext(await pageFunction("profile.js", "getOvertimeLimitForYear"), context);
  assert.equal(context.getOvertimeLimitForYear(2026), 120);
  assert.equal(context.getOvertimeLimitForYear(2027), 120);
});

test("background password-manager input cannot clear the salary snapshot", () => {
  const input = { value: "" };
  assert.equal(restoreUnfocusedNumericInput(input, 67_200, {}), true);
  assert.equal(input.value, "67200");

  input.value = "";
  assert.equal(restoreUnfocusedNumericInput(input, 67_200, input), false);
  assert.equal(input.value, "");
});

test("holiday x2 supplement for days 1-15 goes to the remaining payment", () => {
  const base = computePaymentSplit({
    netTotal: 50_000,
    effectiveOklad: 50_000,
    monthNorm: 160,
    firstHalfDayHours: 88,
    firstHalfNightHours: 0,
  });
  const withFirstHalfHolidaySupplement = computePaymentSplit({
    netTotal: 53_000,
    effectiveOklad: 50_000,
    monthNorm: 160,
    firstHalfDayHours: 88,
    firstHalfNightHours: 0,
  });

  assert.equal(withFirstHalfHolidaySupplement.advance, base.advance);
  assert.equal(withFirstHalfHolidaySupplement.remaining - base.remaining, 3_000);
});

test("queued writes wait for the previous write and recover after rejection", async () => {
  const run = createSerialTaskQueue();
  const gate = deferred();
  const order = [];
  const first = run(async () => { order.push(1); await gate.promise; throw new Error("network"); });
  const second = run(() => order.push(2));
  await Promise.resolve();
  assert.deepEqual(order, [1]);
  gate.resolve();
  await assert.rejects(first, /network/);
  await second;
  assert.deepEqual(order, [1, 2]);
});

for (const page of ["personal", "department"]) {
  const file = page === "personal" ? "table.js" : "admin.js";
  const name = page === "personal" ? "changeTimesheetMonth" : "changeDepartmentMonth";
  for (const failure of [null, "save", "load"]) {
    test(`${page} month transition preserves the old month on ${failure || "no"} failure`, async () => {
      const events = [];
      const shell = { inert: false };
      const context = vm.createContext({
        year: 2026, month: 7, dirty: true, monthTransitionPending: false,
        yearSelect: { value: "2026" }, monthSelect: { value: "8" },
        document: { querySelector: () => shell },
        clearTimeout() {}, timesheetSaveTimer: null, saveTimer: null,
        runTimesheetTask: createSerialTaskQueue(),
        closeDayEditor() {}, applyPersonalTimesheetEditability() {}, isMobileNow: () => false,
        updateUrlForMonth() { events.push(`url:${context.month}`); },
        async saveTimesheetNow() { events.push(`save:${context.month}`); context.dirty = failure === "save"; return !context.dirty; },
        async saveAllNow() { events.push(`save:${context.month}`); context.dirty = failure === "save"; },
        async loadCurrentMonthFromDb(y, m) {
          events.push(`load:${m}`);
          if (failure === "load") return false;
          context.year = y; context.month = m; return true;
        },
        async loadCurrentMonth(y, m) {
          events.push(`load:${m}`);
          if (failure === "load") return false;
          context.year = y; context.month = m; return true;
        },
      });
      vm.runInContext(await pageFunction(file, name), context);
      await context[name]();
      assert.equal(context.month, failure ? 7 : 8);
      assert.equal(context.monthSelect.value, failure ? "7" : "8");
      assert.equal(events[0], "save:7");
      assert.equal(events.includes("load:8"), failure !== "save");
      assert.equal(shell.inert, false);
      assert.equal(context.monthTransitionPending, false);
    });
  }
}

test("editing during a save stays dirty and does not mutate the submitted payload", async () => {
  const gate = deferred();
  const data = { dayHours: [8] };
  let submitted;
  const context = vm.createContext({
    clearTimeout() {}, timesheetSaveTimer: null, personalTimesheetReadOnly: false,
    monthDataLoaded: true,
    year: 2026, month: 8, dirty: true, lastSavedJSON: "", setSaveStatus() {}, setError() {},
    syncActualStateFromInputs() {}, currentPayload: () => data,
    async saveTimesheet(y, m, payload) { submitted = payload; await gate.promise; },
  });
  vm.runInContext(await pageFunction("table.js", "saveTimesheetNow"), context);
  const pending = context.saveTimesheetNow();
  data.dayHours[0] = 11;
  gate.resolve();
  assert.equal(await pending, true);
  assert.equal(submitted.dayHours[0], 8);
  assert.equal(context.dirty, true);
});

test("a late department response cannot render or cache under another department", async () => {
  const first = deferred();
  const second = deferred();
  const requests = [];
  const caches = [];
  const renders = [];
  const context = vm.createContext({
    isLoading: false, selectedDepartmentKey: "egais", currentUserId: "mock", rows: [],
    refreshBtn: {}, updatedAtPill: {}, toLocalIsoDate: () => "2026-09-06",
    setStatus() {}, setError() {},
    listDepartmentShiftOverview({ departmentKey }) {
      requests.push(departmentKey);
      return requests.length === 1 ? first.promise : second.promise;
    },
    saveScheduleSnapshot(snapshot) { caches.push(snapshot); },
    render() { renders.push(context.rows[0]); },
  });
  vm.runInContext(await pageFunction("schedule.js", "loadSchedule"), context);
  const pending = context.loadSchedule();
  context.selectedDepartmentKey = "warehouse";
  await context.loadSchedule();
  first.resolve(["egais employee"]);
  await pending;
  assert.deepEqual(requests, ["egais", "warehouse"]);
  assert.equal(caches[0].departmentKey, "egais");
  assert.deepEqual(renders, []);
  second.resolve(["warehouse employee"]);
  await new Promise(setImmediate);
  assert.deepEqual(renders, ["warehouse employee"]);
  assert.equal(caches[1].departmentKey, "warehouse");
});

test("a full PWA cache does not discard a successful network response", async () => {
  const response = { ok: true, clone: () => ({}) };
  const context = vm.createContext({
    RUNTIME_CACHE: "test", fetch: async () => response,
    caches: { open: async () => ({ put: async () => { throw new Error("QuotaExceededError"); } }) },
  });
  vm.runInContext(await pageFunction("service-worker.js", "networkFirst"), context);
  assert.equal(await context.networkFirst("app.js"), response);
});

test("personal month norm is recomputed from dates and saved day marks", async () => {
  const context = vm.createContext({
    year: 2026, month: 6, daysInMonth: 31, BASE_DAY_HOURS: 8, SHORT_DAY_REDUCTION_HOURS: 1,
    isHoliday: [], isTransferredOff: [], isShortDay: [],
    isWeekendByIndex: (y, m, i) => [0, 6].includes(new Date(y, m, i + 1).getDay()),
  });
  vm.runInContext(await pageFunction("table.js", "calendarNormHours"), context);
  assert.equal(context.calendarNormHours(), 184);
  context.month = 8;
  context.daysInMonth = 30;
  assert.equal(context.calendarNormHours(), 176);
  context.isHoliday[0] = true;
  assert.equal(context.calendarNormHours(), 168);
});

test("profile ignores a superseded year response", async () => {
  const gate = deferred();
  const context = vm.createContext({
    requireDom: () => true, yearSelect: { value: "2025" }, timesheetsList: {},
    overtimeYearEl: {}, overtimeRemainingEl: {}, yearNetIncomeEl: {}, yearTaxPaidEl: {},
    timesheetsLoadRevision: 0, loadedYear: 2026,
    setStatus() {}, setError() {}, listMyTimesheetsByYear: () => gate.promise,
  });
  vm.runInContext(await pageFunction("profile.js", "refreshTimesheets"), context);
  const pending = context.refreshTimesheets();
  context.timesheetsLoadRevision++;
  gate.resolve([]);
  await pending;
  assert.equal(context.loadedYear, 2026);
});

test("notification baseline remembers sent hours, not edits made during delivery", async () => {
  const sentSnapshot = { dayHours: [8] };
  const context = vm.createContext({
    teamStates: [{ userId: "mock", dayHours: [11] }],
    notificationBaselineByUserId: new Map(),
  });
  vm.runInContext(await pageFunction("admin.js", "updateNotificationBaseline"), context);
  context.updateNotificationBaseline(["mock"], new Map([["mock", sentSnapshot]]));
  assert.equal(context.notificationBaselineByUserId.get("mock").dayHours[0], 8);
});

test("profile calendar discards an obsolete production-calendar response", async () => {
  const gate = deferred();
  const context = vm.createContext({
    requireDom: () => true, calGrid: {}, calMonthLabel: {}, initCalendarDow() {},
    calYear: 2026, calMonth: 7, calendarRenderRevision: 0,
    mondayIndex: (day) => (day + 6) % 7, monthNamesFull: Array(12).fill("month"),
    getProductionMonth: () => gate.promise,
    getTimesheetForCalendarMonth() { assert.fail("Stale calendar must not render"); },
  });
  vm.runInContext(await pageFunction("profile.js", "renderCalendar"), context);
  const pending = context.renderCalendar();
  context.calendarRenderRevision++;
  gate.resolve([]);
  await pending;
});

test("Chateau Alvisa uses the 2026 Dagestan production calendar", async () => {
  let annual40 = 0;
  let annualFemale = 0;

  for (let month = 0; month < 12; month += 1) {
    const calendar = await getProductionCalendarMonth(2026, month, { branch: "chateau_alvisa" });
    for (let index = 0; index < calendar.codes.length; index += 1) {
      const weekend = [0, 6].includes(new Date(2026, month, index + 1).getDay());
      if (weekend || calendar.isHoliday[index] || calendar.isTransferredOff[index]) continue;
      annual40 += calendar.isShortDay[index] ? 7 : 8;
      annualFemale += calendar.isShortDay[index] ? 6.2 : 7.2;
    }
  }

  assert.equal(annual40, 1896);
  assert.equal(Math.round(annualFemale), 1706);
});

test("calendar defaults apply once and preserve later manual removal", async () => {
  const calendar = await getProductionCalendarMonth(2026, 8, { branch: "chateau_alvisa" });
  const migrated = mergeProductionCalendarDefaults({ year: 2026, month: 8 }, calendar);
  assert.equal(migrated.isHoliday[14], true);
  migrated.isHoliday[14] = false;
  assert.equal(mergeProductionCalendarDefaults(migrated, calendar).isHoliday[14], false);
});

test("temporary push failures remain eligible for retry", async () => {
  const source = await readFile(new URL("../supabase/functions/send-push-notifications/index.ts", import.meta.url), "utf8");
  assert.match(source, /if \(notificationSent > 0\) update\.push_sent_at/);
  assert.doesNotMatch(source, /\.in\("id", rows\.map/);
});

test("timesheet cells reject browser autofill outside deliberate editing", () => {
  const input = {
    value: "89633757579",
    autocomplete: "",
    dataset: { prev: "" },
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
    matches: () => true,
  };
  const previousDocument = globalThis.document;
  globalThis.document = { activeElement: input };
  try {
    hardenTimesheetInput(input);
    assert.equal(input.autocomplete, "off");
    assert.equal(input.attributes.get("data-lpignore"), "true");
    assert.equal(rejectUnexpectedTimesheetAutofill(input), true);
    assert.equal(input.value, "");

    input.value = "11";
    input.matches = () => false;
    assert.equal(rejectUnexpectedTimesheetAutofill(input), false);
    assert.equal(input.value, "11");
  } finally {
    globalThis.document = previousDocument;
  }
});
