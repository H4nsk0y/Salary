import assert from "node:assert/strict";
import { test } from "node:test";

import { buildShiftCalendarEvents, buildShiftCalendarIcs } from "../calendarExport.js";

test("exports an eleven-hour day shift with exact time", () => {
  const events = buildShiftCalendarEvents({
    year: 2026,
    month: 7,
    dayHours: [11],
    nightHours: [0],
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].summary, "Дневная смена");
  assert.equal(events[0].start.hour, 8);
  assert.equal(events[0].end.hour, 20);
});

test("keeps an ambiguous eight-hour shift as an all-day calendar entry", () => {
  const events = buildShiftCalendarEvents({
    year: 2026,
    month: 7,
    dayHours: [8],
    nightHours: [0],
  });

  assert.equal(events[0].allDay, true);
  assert.match(events[0].summary, /8 ч/);
});

test("joins the common 2/2 and 2/5 night pattern into one event", () => {
  const events = buildShiftCalendarEvents({
    year: 2026,
    month: 7,
    dayHours: [2, 2],
    nightHours: [2, 5],
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].summary, "Ночная смена");
  assert.equal(events[0].start.hour, 20);
  assert.equal(events[0].end.day, 2);
  assert.equal(events[0].end.hour, 8);
});

test("includes a shift comment and emits Moscow time as UTC", () => {
  const result = buildShiftCalendarIcs({
    year: 2026,
    month: 7,
    dayHours: [11],
    nightHours: [0],
    shiftComments: ["Начать в 11:00"],
    generatedAt: new Date("2026-08-01T00:00:00.000Z"),
  });

  assert.match(result.content, /DTSTART:20260801T050000Z/);
  assert.match(result.content, /Комментарий: Начать в 11:00/);
  assert.match(result.content, /\r\nEND:VCALENDAR\r\n$/);
});
