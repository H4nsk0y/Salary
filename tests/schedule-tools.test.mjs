import assert from "node:assert/strict";
import test from "node:test";

import { planEightHourTemplate, planFillToNorm, planReduceOvertime, planTeamNormFills, planTeamOvertimeReductions } from "../features/scheduleTools.js";
import { planCoveredShiftCycle } from "../features/shiftCycles.js";
import { formatScheduleChangeReport, selectedHoursLabel } from "../features/adminScheduleTools.js";

const days = (count) => Array.from({ length: count }, () => ({ dayHours: 0, nightHours: 0 }));

test("five-two template skips weekends and marked holidays", () => {
  const holiday = Array(31).fill(false);
  holiday[0] = true;
  const plan = planEightHourTemplate({ mode: "fiveTwo", year: 2026, month: 9, existingDays: days(31), holiday });
  assert.ok(!plan.changes.some((change) => change.index === 0));
  assert.ok(!plan.changes.some((change) => change.index === 2));
  assert.deepEqual(plan.changes.find((change) => change.index === 1)?.to, { dayHours: 8, nightHours: 0 });
});

test("confirmed leader converts existing work to five-two but preserves absence", () => {
  const schedule = days(31);
  schedule[0] = { dayHours: 11, nightHours: 0 };
  schedule[2] = { dayHours: 2, nightHours: 5 };
  schedule[5] = { dayHours: 0, nightHours: 0, leaveType: "vacation" };
  const plan = planEightHourTemplate({ mode: "fiveTwo", year: 2026, month: 9,
    existingDays: schedule, replaceWorked: true });
  assert.deepEqual(plan.changes.find(({ index }) => index === 0)?.to, { dayHours: 8, nightHours: 0 });
  assert.deepEqual(plan.changes.find(({ index }) => index === 2)?.to, { dayHours: 0, nightHours: 0 });
  assert.ok(!plan.changes.some(({ index }) => index === 5));
});

test("alternating eight-hour groups swap day and evening each Monday", () => {
  const first = planEightHourTemplate({ mode: "alternating", year: 2026, month: 9, existingDays: days(31), group: 0 });
  const second = planEightHourTemplate({ mode: "alternating", year: 2026, month: 9, existingDays: days(31), group: 1 });
  assert.notDeepEqual(first.changes[0].to, second.changes[0].to);
  assert.notDeepEqual(first.changes.find((change) => change.index === 5).to, first.changes[0].to);
});

test("15 missing hours become an 8-hour and an 11-hour day shift", () => {
  const existingDays = days(30);
  const plan = planFillToNorm({ existingDays, personalNorm: 15 });
  assert.deepEqual(plan.changes.map(({ to }) => to.dayHours), [8, 11]);
  assert.deepEqual(plan.changes.map(({ index }) => index), [1, 2]);
  assert.equal(plan.after, 19);
});

test("fill to norm uses day one after a completed rest day but not an unfinished night", () => {
  const schedule = days(30);
  assert.equal(planFillToNorm({ existingDays: schedule, personalNorm: 8 }).changes[0].index, 1);
  assert.equal(planFillToNorm({ existingDays: schedule, personalNorm: 8,
    previousDay: { dayHours: 0, nightHours: 0 } }).changes[0].index, 0);
  assert.equal(planFillToNorm({ existingDays: schedule, personalNorm: 8,
    previousDay: { dayHours: 2, nightHours: 5 } }).changes[0].index, 0);
  assert.equal(planFillToNorm({ existingDays: schedule, personalNorm: 8,
    previousDay: { dayHours: 2, nightHours: 2 } }).changes[0].index, 1);
});

test("fill to norm never uses the day after an unfinished night or an absence itself", () => {
  const existingDays = days(28);
  existingDays[0] = { dayHours: 2, nightHours: 2 };
  existingDays[2] = { dayHours: 0, nightHours: 0, leaveType: "vacation" };
  const plan = planFillToNorm({ existingDays, personalNorm: 22 });
  assert.deepEqual(plan.changes.map(({ index }) => index), [3, 4]);
});

test("fill to norm can add a day shift on the free day after 2/5 in a complete 2/2 cycle", () => {
  const members = Array.from({ length: 4 }, (_, index) => ({ id: String(index), days: days(31) }));
  const cycle = planCoveredShiftCycle({ cycleId: "dayNight48", members, year: 2026, month: 9 });
  assert.deepEqual(cycle.gaps, []);
  for (const { id, plan } of cycle.plans) {
    const schedule = members.find((member) => member.id === id).days.map((day, index) =>
      plan.changes.find((change) => change.index === index)?.to ?? day);
    const fill = planFillToNorm({ existingDays: schedule, personalNorm: 176,
      previousDay: { dayHours: 0, nightHours: 0 } });
    assert.equal(fill.shortage, 0, `operator ${id}`);
    for (const change of fill.changes) {
      assert.deepEqual(schedule[change.index], { dayHours: 0, nightHours: 0 });
      assert.notEqual(schedule[change.index - 1]?.nightHours, 2);
    }
  }
});

test("fill to norm prefers a free weekday and uses the first weekend only as fallback", () => {
  const schedule = Array.from({ length: 31 }, () => ({ dayHours: 8, nightHours: 0 }));
  schedule[2] = { dayHours: 0, nightHours: 0 }; // Saturday, October 3
  schedule[4] = { dayHours: 0, nightHours: 0 }; // Monday, October 5
  const weekdayPlan = planFillToNorm({ existingDays: schedule, personalNorm: 240, year: 2026, month: 9 });
  assert.deepEqual(weekdayPlan.changes.map(({ index }) => index), [4]);

  schedule[4] = { dayHours: 8, nightHours: 0 };
  const weekendPlan = planFillToNorm({ existingDays: schedule, personalNorm: 248, year: 2026, month: 9 });
  assert.deepEqual(weekendPlan.changes.map(({ index }) => index), [2]);
});

test("change report includes employee, dates, before/after shifts, total and norm", () => {
  const state = { name: "Иванов Иван", dayHours: [11, 8], nightHours: [0, 0] };
  const changes = [{ index: 0, from: { dayHours: 11, nightHours: 0 }, to: { dayHours: 8, nightHours: 0 } }];
  assert.equal(formatScheduleChangeReport(state, changes, 16),
    "Иванов Иван — изменено смен: 1; 1: 11 ч → 8 ч; после: 16 ч; норма: 16 ч");
});

test("selection labels show shortage or overtime against the personal norm", () => {
  const state = { dayHours: [11, 8], nightHours: [0, 0] };
  assert.equal(selectedHoursLabel("fillNorm", state, 27), "Не хватает 8 ч");
  assert.equal(selectedHoursLabel("reduceOvertime", state, 16), "Переработка 3 ч");
  assert.equal(selectedHoursLabel("reduceOvertime", state, 19), "Без переработки");
});

test("overtime reduction needs another worker and uses only full or 11-to-8 day shifts", () => {
  const existingDays = days(28);
  existingDays[0] = { dayHours: 11, nightHours: 0 };
  existingDays[1] = { dayHours: 11, nightHours: 0 };
  existingDays[2] = { dayHours: 11, nightHours: 0 };
  const otherWorker = days(28);
  otherWorker[0] = { dayHours: 8, nightHours: 0 };
  otherWorker[1] = { dayHours: 8, nightHours: 0 };
  const plan = planReduceOvertime({ existingDays, personalNorm: 20, coworkers: [otherWorker] });
  assert.deepEqual(plan.changes.map(({ index }) => index), [0]);
  assert.equal(plan.after, 22);
  assert.deepEqual(planReduceOvertime({ existingDays, personalNorm: 20, coworkers: [] }).changes, []);
  const restDay = days(28);
  restDay[0] = { dayHours: 2, nightHours: 5 };
  assert.deepEqual(planReduceOvertime({ existingDays, personalNorm: 20, coworkers: [restDay] }).changes, []);
});

test("four and twenty employees receive extra shifts across different dates", () => {
  for (const count of [4, 20]) {
    const members = Array.from({ length: count }, (_, index) => ({ id: index, selected: true, excluded: false,
      norm: 8, days: days(31) }));
    const plans = planTeamNormFills(members);
    assert.equal(plans.length, count);
    assert.equal(new Set(plans.map(({ plan }) => plan.changes[0].index)).size, count);
  }
});

test("team reduction cannot remove both coworkers from the same day", () => {
  const members = [1, 2].map((id) => {
    const schedule = days(28);
    schedule[0] = { dayHours: 11, nightHours: 0 };
    return { id, selected: true, excluded: false, norm: 0, days: schedule };
  });
  const plans = planTeamOvertimeReductions(members);
  assert.equal(plans.reduce((total, { plan }) => total + plan.changes.filter(({ to }) => to.dayHours === 0).length, 0), 1);
});
