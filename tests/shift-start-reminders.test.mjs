import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../supabase/functions/send-shift-reminders/index.ts", import.meta.url), "utf8");

function setup(iso) {
  const instant = new Date(iso);
  const part = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", day: "numeric" }).format(instant);
  const index = Number(part) - 1;
  const month = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", month: "numeric" }).format(instant)) - 1;
  const year = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric" }).format(instant));
  const users = ["day", "night", "rest", "leave", "leader", "editor", "second-night", "reduced-rest"];
  const payload = (day, night, leave = null) => {
    const result = { dayHours: [], nightHours: [], leaveType: [] };
    result.dayHours[index] = day;
    result.nightHours[index] = night;
    result.leaveType[index] = leave;
    return result;
  };
  const hours = [[11, 0], [2, 2], [2, 5], [11, 0, "ОТ"], [8, 0], [8, 0], [4, 7], [1, 5]];
  const tables = {
    push_subscriptions: users.map((user_id) => ({ id: user_id, user_id, enabled: true })),
    department_editors: [{ user_id: "leader", is_leader: true }, { user_id: "editor", is_leader: false }],
    timesheets: users.map((user_id, i) => ({ user_id, year, month, payload: payload(...hours[i]) })),
    user_notifications: [],
  };
  const sent = [];
  function from(table) {
    const filters = [];
    let inserted = null;
    const query = {
      select() { return query; },
      eq(key, value) { filters.push((row) => row[key] === value); return query; },
      in(key, values) { filters.push((row) => values.includes(row[key])); return query; },
      gte(key, value) { filters.push((row) => row[key] >= value); return query; },
      or() { return query; },
      insert(rows) {
        inserted = rows.map((row, i) => ({ ...row, id: tables.user_notifications.length + i + 1, created_at: iso }));
        tables[table].push(...inserted);
        return query;
      },
      update() { return query; },
      then(resolve) {
        return Promise.resolve({ data: inserted ?? tables[table].filter((row) => filters.every((filter) => filter(row))), error: null }).then(resolve);
      },
    };
    return query;
  }
  let handler;
  const context = vm.createContext({
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [iso])); }
      static now() { return instant.getTime(); }
    },
    Intl, TextEncoder, Response,
    Deno: { env: { get: () => "test-secret" } },
    createClient: () => ({ from }),
    webpush: { setVapidDetails() {}, async sendNotification(_subscription, body) { sent.push(JSON.parse(body)); } },
    serve: (fn) => { handler = fn; },
  });
  const code = source.replace(/^import .*;\r?\n/gm, "");
  vm.runInContext(stripTypeScriptTypes(code), context);
  return {
    tables, sent,
    invoke: (secret = "test-secret") => handler(new Request("https://example.test", {
      method: "POST", headers: { Authorization: "Bearer test", "x-cron-secret": secret },
    })),
  };
}

test("08:05 Moscow reminds daytime employees, excludes leaders and absences", async () => {
  const fixture = setup("2026-10-10T05:05:00Z");
  assert.equal((await fixture.invoke()).status, 200);
  assert.deepEqual(fixture.tables.user_notifications.map((row) => row.user_id), ["day", "editor"]);
  assert.ok(fixture.sent.every((row) => row.body === "Заполните чек-лист на смену, чтобы ничего не забыть!" && row.url === "checklist.html"));
  await fixture.invoke();
  assert.equal(fixture.tables.user_notifications.length, 2);
});

test("20:05 Moscow handles both night codes and month end, not rest days", async () => {
  const fixture = setup("2026-12-31T17:05:00Z");
  await fixture.invoke();
  assert.deepEqual(fixture.tables.user_notifications.map((row) => row.user_id), ["night", "second-night"]);
});

test("reminder only runs in the scheduled time window with the cron secret", async () => {
  for (const iso of ["2026-10-10T05:04:00Z", "2026-10-10T17:21:00Z"]) {
    const fixture = setup(iso);
    assert.equal((await (await fixture.invoke()).json()).skipped, "OUTSIDE_REMINDER_TIME");
    assert.equal(fixture.sent.length, 0);
  }
  const fixture = setup("2026-10-10T05:05:00Z");
  assert.equal((await fixture.invoke("wrong")).status, 401);
  assert.equal(fixture.sent.length, 0);
});

test("new cron uses 08:05 / 20:05 Moscow and does not replace the 17:00 job", async () => {
  const sql = await readFile(new URL("../supabase-sql/070_shift_start_checklist_reminders.sql", import.meta.url), "utf8");
  assert.match(sql, /'5 5,17 \* \* \*'/);
  assert.match(sql, /jobname = 'alvisa-shift-start-checklists'/);
  assert.doesNotMatch(sql, /jobname = 'alvisa-upcoming-shift-reminders'/);
});
