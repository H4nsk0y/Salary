import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { findNextShift } from "../nextShift.js";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function monthPayload(dayHours = [], nightHours = [], leaveType = []) {
  return { dayHours, nightHours, leaveType };
}

test("home dashboard finds the next day shift and skips absences", () => {
  const payload = monthPayload([], [], []);
  payload.dayHours[10] = 8;
  payload.dayHours[11] = 8;
  payload.leaveType[10] = "vac_paid";
  const shift = findNextShift([{ year: 2026, month: 8, payload }], new Date(2026, 8, 10, 12));
  assert.equal(shift?.daysUntil, 2);
  assert.equal(shift?.label, "Дневная смена · 8 ч");
});

test("home dashboard presents a night start and omits its rest day", () => {
  const payload = monthPayload([], [], []);
  payload.dayHours[9] = 2;
  payload.nightHours[9] = 2;
  payload.dayHours[10] = 2;
  payload.nightHours[10] = 5;
  payload.dayHours[11] = 11;
  const night = findNextShift([{ year: 2026, month: 8, payload }], new Date(2026, 8, 10, 12));
  const afterNight = findNextShift([{ year: 2026, month: 8, payload }], new Date(2026, 8, 11, 12));
  assert.equal(night?.label, "Ночная смена · 11 ч");
  assert.equal(afterNight?.daysUntil, 1);
});

test("scheduled shift reminders are protected, daily and non-duplicating", async () => {
  const [edge, sql] = await Promise.all([
    source("supabase/functions/send-shift-reminders/index.ts"),
    source("supabase-sql/045_upcoming_shift_reminders.sql"),
  ]);
  assert.match(edge, /constantTimeEqual/);
  assert.match(edge, /INVALID_CRON_SECRET/);
  assert.match(edge, /today\.hour !== 17/);
  assert.match(edge, /tomorrowNonNight/);
  assert.match(edge, /alreadyNotified/);
  assert.match(sql, /'0 14 \* \* \*'/);
  assert.match(sql, /send-shift-reminders/);
});

test("push test no longer depends on the client RPC and handled failures are reported", async () => {
  const [pushClient, pushEdge, settings, errors, html] = await Promise.all([
    source("pushNotifications.js"),
    source("supabase/functions/send-push-notifications/index.ts"),
    source("settings.js"),
    source("clientErrorInsights.js"),
    source("settings.html"),
  ]);
  assert.doesNotMatch(pushClient, /createMyPushTestNotification/);
  assert.match(pushEdge, /existingTests/);
  assert.match(pushEdge, /Тестовое уведомление/);
  assert.match(settings, /reportHandledClientError\("push_test_error"/);
  assert.match(errors, /DB-RPC-001/);
  assert.match(html, /Уведомления на устройстве/);
});

