import assert from "node:assert/strict";
import test from "node:test";

import { planBottlingSchedule } from "../features/bottlingSchedule.js";
import { planEightHourTemplate, planFillToNorm, planReduceOvertime } from "../features/scheduleTools.js";
import { planShiftCycle } from "../features/shiftCycles.js";

const blank = () => ({ dayHours: 0, nightHours: 0 });
const team = (year, month, norm = 160) => Array.from({ length: 4 }, (_, id) => ({
  id: String(id), name: `Оператор ${id}`, norm,
  days: Array.from({ length: new Date(year, month + 1, 0).getDate() }, blank),
}));
const resultDays = (members, result) => members.map((member) => {
  const days = member.days.map((day) => ({ ...day }));
  for (const { index, to } of result.plans.find((item) => item.id === member.id).plan.changes) days[index] = { ...days[index], ...to };
  return days;
});

test("four operators cover each weekday with one night and rotate Monday lead", () => {
  const members = team(2026, 5, 0);
  const result = planBottlingSchedule({ members, year: 2026, month: 5 });
  assert.equal(result.error, null);
  const days = resultDays(members, result);
  for (let index = 0; index < 30; index++) {
    const weekday = new Date(2026, 5, index + 1).getDay();
    const nights = days.filter((person) => person[index].dayHours === 2 && person[index].nightHours === 2).length;
    if (weekday > 0 && weekday < 6) {
      assert.equal(nights, 1, `night ${index + 1}`);
      assert.ok(days.some((person) => person[index].dayHours >= 8 && !person[index].nightHours));
    } else {
      assert.equal(nights, 0);
      assert.ok(days.every((person) => person[index].dayHours === 0 ||
        (weekday === 6 && person[index].dayHours === 2 && person[index].nightHours === 5)));
    }
  }
  const mondayLeads = [0, 7, 14, 21].map((index) => days.findIndex((person) => person[index].dayHours === 11 && !person[index].nightHours));
  assert.equal(new Set(mondayLeads).size, 4);
});

test("official holiday has no new start, but previous night can finish", () => {
  const members = team(2026, 5, 0);
  const holiday = Array(30).fill(false);
  holiday[4] = true;
  const result = planBottlingSchedule({ members, year: 2026, month: 5, holiday });
  assert.equal(result.error, null);
  const days = resultDays(members, result);
  assert.ok(days.every((person) => !person[4].dayHours && !person[4].nightHours ||
    (person[4].dayHours === 2 && person[4].nightHours === 5)));
  for (const person of days) for (let index = 1; index < person.length; index++) {
    if (person[index].dayHours === 2 && person[index].nightHours === 5) {
      assert.ok(person[index - 1].nightHours > 0, `orphan rest on ${index + 1}`);
    }
  }
});

test("absence is preserved and eligible coworkers take coverage", () => {
  const members = team(2026, 5, 160);
  members[0].days[0] = { dayHours: 0, nightHours: 0, leaveType: "Б" };
  const result = planBottlingSchedule({ members, year: 2026, month: 5 });
  assert.equal(result.error, null);
  assert.ok(!result.plans[0].plan.changes.some((change) => change.index === 0));
  const days = resultDays(members, result);
  assert.ok(days.some((person) => person[0].dayHours >= 8 && !person[0].nightHours));
  assert.equal(days.filter((person) => person[0].dayHours === 2 && person[0].nightHours === 2).length, 1);
});

test("midmonth transition preserves prior work and night rest", () => {
  const members = team(2026, 5, 160);
  for (const member of members) for (let index = 0; index < 5; index++) member.days[index] = { dayHours: 8, nightHours: 0 };
  members[0].days[4] = { dayHours: 2, nightHours: 2 };
  members[0].days[5] = { dayHours: 2, nightHours: 5 };
  const result = planBottlingSchedule({ members, year: 2026, month: 5 });
  assert.equal(result.error, null);
  assert.ok(result.startIndex >= 7);
  assert.ok(result.plans.every(({ plan }) => plan.changes.every(({ index }) => index >= result.startIndex)));
});

test("night from the previous month finishes on a weekend before the first workweek", () => {
  const members = team(2026, 7, 0);
  members[0].previousDay = { dayHours: 4, nightHours: 7 };
  const result = planBottlingSchedule({ members, year: 2026, month: 7 });
  assert.equal(result.error, null);
  assert.deepEqual(result.plans[0].plan.changes.find((change) => change.index === 0)?.to,
    { dayHours: 2, nightHours: 5 });
});

test("only fewer than two operators are rejected, and codes stay intact", () => {
  const members = team(2026, 5);
  assert.equal(planBottlingSchedule({ members: members.slice(0, 3), year: 2026, month: 5 }).error, null);
  assert.match(planBottlingSchedule({ members: members.slice(0, 1), year: 2026, month: 5 }).error, /минимум двух/);
  members[0].days[0].leaveType = "ОТ";
  const days = members[0].days;
  assert.ok(!planEightHourTemplate({ mode: "fiveTwo", year: 2026, month: 5, existingDays: days }).changes.some((change) => change.index === 0));
  assert.ok(!planFillToNorm({ existingDays: days, personalNorm: 8, year: 2026, month: 5 }).changes.some((change) => change.index === 0));
  assert.ok(!planReduceOvertime({ existingDays: days, personalNorm: 0 }).changes.some((change) => change.index === 0));
  assert.ok(!planShiftCycle({ cycleId: "dayNight48", firstPhase: 0, existingDays: days }).changes.some((change) => change.index === 0));
});

test("larger bottling teams are distributed without a four-person limit", () => {
  const count = 8;
  const members = Array.from({ length: count }, (_, id) => ({
    id: String(id), name: `Оператор ${id}`, norm: 176,
    days: Array.from({ length: 31 }, blank),
  }));
  const result = planBottlingSchedule({ members, year: 2026, month: 9 });
  assert.equal(result.error, null);
  assert.equal(result.plans.length, count);
  assert.ok(result.plans.every(({ plan }) => plan.changes.length > 0));
});

test("an additional operator still receives rest after a previous-month night", () => {
  const members = Array.from({ length: 6 }, (_, id) => ({
    id: String(id), name: `Оператор ${id}`, norm: 176,
    days: Array.from({ length: 31 }, blank),
  }));
  members[5].previousDay = { dayHours: 2, nightHours: 2 };
  const result = planBottlingSchedule({ members, year: 2026, month: 9 });
  assert.equal(result.error, null);
  assert.deepEqual(result.plans[5].plan.changes.find(({ index }) => index === 0)?.to,
    { dayHours: 2, nightHours: 5 });
});

test("previous month night becomes one rest day while an existing rest is not repeated", () => {
  const members = team(2026, 9, 0);
  members[0].previousDay = { dayHours: 2, nightHours: 2 };
  members[1].previousDay = { dayHours: 2, nightHours: 5 };
  const result = planBottlingSchedule({ members, year: 2026, month: 9 });
  assert.equal(result.error, null);
  assert.deepEqual(result.plans[0].plan.changes.find(({ index }) => index === 0)?.to,
    { dayHours: 2, nightHours: 5 });
  assert.notDeepEqual(result.plans[1].plan.changes.find(({ index }) => index === 0)?.to,
    { dayHours: 2, nightHours: 5 });
});

test("warehouse bottling coverage keeps three loaders by day and five on selected two-line dates", () => {
  const members = Array.from({ length: 6 }, (_, id) => ({
    id: String(id), name: `Грузчик ${id}`, norm: 176,
    days: Array.from({ length: 31 }, blank),
  }));
  const result = planBottlingSchedule({
    members, year: 2026, month: 9,
    minimumDayCoverage: 3,
    boostedDayCoverage: 5,
    boostedDayIndices: [0],
    coverageEligibleIds: members.map(({ id }) => id),
  });
  assert.equal(result.error, null);
  const schedule = resultDays(members, result);
  assert.equal(schedule.filter((person) => person[0].dayHours >= 8 && !person[0].nightHours).length, 5);
  assert.ok(schedule.filter((person) => person[1].dayHours >= 8 && !person[1].nightHours).length >= 3);
});

test("bottling planner assigns a restricted employee only to day shifts", () => {
  const members = team(2026, 9, 176);
  members[0].noNight = true;
  const result = planBottlingSchedule({ members, year: 2026, month: 9 });
  assert.equal(result.error, null);
  const restricted = result.plans.find(({ id }) => id === members[0].id);
  assert.ok(restricted.plan.changes.some(({ to }) => to.dayHours >= 8 && to.nightHours === 0));
  assert.ok(restricted.plan.changes.every(({ to }) => to.nightHours === 0));
});

test("when the target norm cannot be reached, available weekdays still get filled", () => {
  const members = team(2026, 5, 220);
  const result = planBottlingSchedule({ members, year: 2026, month: 5 });
  assert.equal(result.error, null);
  assert.ok(result.plans.every(({ plan }) => plan.after > 160 && plan.shortage > 0));
  const days = resultDays(members, result);
  for (let index = 0; index < 30; index++) {
    const day = new Date(2026, 5, index + 1).getDay();
    assert.ok(days.filter((person) => person[index].dayHours === 2 && person[index].nightHours === 2).length <= 2);
    if (day === 0 || day === 6) assert.ok(days.every((person) => person[index].dayHours === 0 ||
      (day === 6 && person[index].dayHours === 2 && person[index].nightHours === 5)));
  }
});

test("codes are preserved while the available operators cover the month", () => {
  const members = team(2026, 0);
  const holiday = Array.from({ length: 31 }, (_, index) => (index + 27) % 17 === 0);
  for (let person = 0; person < 4; person++) for (let index = 0; index < 31; index++) {
    if ((index + person * 7 + 99) % 43 === 0) members[person].days[index].leaveType = "Б";
  }
  const result = planBottlingSchedule({ members, year: 2026, month: 0, holiday });
  assert.equal(result.error, null);
  const days = resultDays(members, result);
  for (let person = 0; person < 4; person++) for (let index = 0; index < 31; index++) {
    if (members[person].days[index].leaveType) assert.equal(days[person][index].leaveType, "Б");
  }
});

test("bottling with three operators covers weekdays and leaves weekends free", () => {
  const members = team(2026, 5).slice(0, 3);
  const result = planBottlingSchedule({ members, year: 2026, month: 5 });
  assert.equal(result.error, null);
  const days = resultDays(members, result);
  for (let index = 0; index < 30; index++) {
    const weekday = new Date(2026, 5, index + 1).getDay();
    if (weekday > 0 && weekday < 6) {
      assert.ok(days.some((person) => person[index].dayHours >= 8 && !person[index].nightHours));
      assert.ok(days.some((person) => person[index].nightHours === 2 || person[index].nightHours === 7));
    } else {
      assert.ok(days.every((person) => person[index].dayHours === 0 ||
        (weekday === 6 && person[index].dayHours === 2 && person[index].nightHours === 5)));
    }
  }
});

test("two bottling operators swap day and night after the weekend", () => {
  const members = team(2026, 5).slice(0, 2);
  const result = planBottlingSchedule({ members, year: 2026, month: 5 });
  assert.equal(result.error, null);
  const days = resultDays(members, result);
  const firstMondayNight = days.findIndex((person) => person[0].nightHours === 2);
  const secondMondayNight = days.findIndex((person) => person[7].nightHours === 2);
  assert.notEqual(firstMondayNight, secondMondayNight);
  assert.deepEqual([days[firstMondayNight][0].nightHours, days[firstMondayNight][1].nightHours], [2, 7]);
});

test("bottling returns the fourth operator to a day shift after leave", () => {
  const members = team(2026, 9, 176);
  for (let index = 0; index < 14; index++) members[3].days[index].leaveType = "ОТ";
  const result = planBottlingSchedule({ members, year: 2026, month: 9 });
  assert.equal(result.error, null);
  assert.deepEqual(result.plans[3].plan.changes.find(({ index }) => index === 14).to,
    { dayHours: 11, nightHours: 0 });
});

test("after Friday leave, the returning operator starts Monday in the day", () => {
  const members = team(2026, 9, 176);
  for (let index = 0; index < 16; index++) members[3].days[index].leaveType = "ОТ";
  const result = planBottlingSchedule({ members, year: 2026, month: 9 });
  assert.equal(result.error, null);
  assert.deepEqual(result.plans[3].plan.changes.find(({ index }) => index === 18).to,
    { dayHours: 11, nightHours: 0 });
});

test("two absent bottling operators leave weekday day-night coverage without weekend starts", () => {
  const members = team(2026, 9, 176);
  for (let index = 0; index < 14; index++) {
    members[2].days[index].leaveType = "Б";
    members[3].days[index].leaveType = "ОТ";
  }
  const result = planBottlingSchedule({ members, year: 2026, month: 9 });
  assert.equal(result.error, null);
  const days = resultDays(members, result);
  for (let index = 0; index < 14; index++) {
    const dayOfWeek = new Date(2026, 9, index + 1).getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      assert.ok(days.every((person) => !person[index].nightHours || person[index].nightHours === 5));
    } else {
      assert.ok(days.some((person) => person[index].dayHours >= 8 && !person[index].nightHours));
      assert.ok(days.some((person) => person[index].nightHours === 2 || person[index].nightHours === 7));
    }
  }
});
