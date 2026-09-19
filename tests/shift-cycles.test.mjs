import assert from "node:assert/strict";
import test from "node:test";

import {
  SHIFT_CYCLES,
  inferNextShiftCyclePhase,
  planCoveredShiftCycle,
  planShiftCycle,
} from "../features/shiftCycles.js";

const emptyMonth = (days = 31) => Array.from({ length: days }, () => ({ dayHours: 0, nightHours: 0 }));
const fullMonth = (cycleId, startPhase, days = 31) =>
  Array.from({ length: days }, (_, index) => SHIFT_CYCLES[cycleId][(startPhase + index) % SHIFT_CYCLES[cycleId].length]);
const mixedFirstWeek = () => {
  const members = Array.from({ length: 4 }, (_, index) => ({
    id: `employee-${index + 1}`,
    days: Array.from({ length: 30 }, (_, day) => ({ dayHours: day < 5 ? 11 : 0, nightHours: 0 })),
  }));
  members[0].days[4] = { dayHours: 2, nightHours: 2 };
  members[0].days[5] = { dayHours: 2, nightHours: 5 };
  members[1].days[2] = { dayHours: 0, nightHours: 0 };
  members[1].days[3] = { dayHours: 0, nightHours: 0 };
  members[1].days[4] = { dayHours: 0, nightHours: 0 };
  return members;
};

test("four and twenty operators cover every day and night without manual groups", () => {
  for (const cycleId of ["dayNight48", "twoDaysTwoNights48"]) {
    for (const count of [4, 20]) {
      const members = Array.from({ length: count }, (_, index) => ({ id: `employee-${index + 1}`, days: emptyMonth() }));
      const result = planCoveredShiftCycle({ cycleId, members, year: 2026, month: 9 });
      assert.deepEqual(result.gaps, []);
      assert.equal(result.plans.length, count);
      assert.equal(new Set(result.plans.slice(0, 4).map(({ phase }) => phase)).size, 4);
      assert.deepEqual(planCoveredShiftCycle({ cycleId, members, year: 2026, month: 9 }), result);
    }
  }
});

test("leader is excluded and three operators switch to day-night-rest", () => {
  const members = Array.from({ length: 4 }, (_, index) => ({ id: index + 1, days: emptyMonth(), isLeader: index === 0 }));
  const result = planCoveredShiftCycle({ cycleId: "dayNight48", members, year: 2026, month: 9 });
  assert.equal(result.error, null);
  assert.equal(result.plans.length, 3);
  assert.ok(result.plans.every(({ id }) => id !== 1));
  assert.deepEqual(result.plans.find(({ id }) => id === 2).plan.changes.slice(0, 3).map(({ to }) =>
    [to.dayHours, to.nightHours]), [[11, 0], [2, 2], [2, 5]]);
  const fifth = { id: 5, days: emptyMonth(), isLeader: false };
  const covered = planCoveredShiftCycle({ cycleId: "dayNight48", members: [...members, fifth], year: 2026, month: 9 });
  assert.deepEqual(covered.gaps, []);
  assert.equal(covered.plans.length, 4);
});

test("fewer than two available operators blocks coverage with a readable explanation", () => {
  const members = Array.from({ length: 4 }, (_, index) => ({ id: index + 1, days: emptyMonth() }));
  for (const member of members) member.days[0] = { dayHours: 0, nightHours: 0, leaveType: "vacation" };
  const result = planCoveredShiftCycle({ cycleId: "dayNight48", members, year: 2026, month: 9 });
  assert.match(result.error, /1-го числа доступно 0 операторов/);
  assert.deepEqual(result.plans, []);
});

test("two operators cover every day without sending a night worker straight to day", () => {
  const members = Array.from({ length: 2 }, (_, id) => ({ id, days: emptyMonth() }));
  const result = planCoveredShiftCycle({ cycleId: "dayNight48", members, year: 2026, month: 9 });
  assert.equal(result.error, null);
  const nights = result.plans.map(({ plan }) => plan.changes.find(({ index }) => index === 0)?.to);
  assert.ok(nights.some(({ dayHours, nightHours }) => dayHours === 11 && nightHours === 0));
  assert.ok(nights.some(({ dayHours, nightHours }) => dayHours === 2 && nightHours === 2));
  const nightPerson = result.plans.find(({ plan }) => plan.changes.some(({ index, to }) => index === 0 && to.nightHours === 2));
  assert.deepEqual(nightPerson.plan.changes.find(({ index }) => index === 1).to,
    { dayHours: 4, nightHours: 7 });
});

test("both continuous cycles keep a restricted employee out of night shifts", () => {
  for (const cycleId of ["dayNight48", "twoDaysTwoNights48"]) {
    const members = Array.from({ length: 4 }, (_, id) => ({
      id,
      noNight: id === 0,
      days: emptyMonth(),
    }));
    const result = planCoveredShiftCycle({ cycleId, members, year: 2026, month: 9 });
    assert.equal(result.error, null, cycleId);
    assert.deepEqual(result.gaps, [], cycleId);
    const restricted = result.plans.find(({ id }) => id === 0);
    assert.ok(restricted.plan.changes.some(({ to }) => to.dayHours >= 8 && to.nightHours === 0));
    assert.ok(restricted.plan.changes.every(({ to }) => to.nightHours === 0), cycleId);
  }
});

test("fourth operator returns from leave to a day shift and restores the four-person cycle", () => {
  const members = Array.from({ length: 4 }, (_, id) => ({ id, days: emptyMonth() }));
  for (let index = 0; index < 14; index++) members[3].days[index].leaveType = "ОТ";
  const result = planCoveredShiftCycle({ cycleId: "dayNight48", members, year: 2026, month: 9 });
  assert.equal(result.error, null);
  assert.ok(result.plans[3].plan.changes.every(({ index }) => index >= 14));
  assert.deepEqual(result.plans[3].plan.changes.find(({ index }) => index === 14).to,
    { dayHours: 11, nightHours: 0 });
  for (let index = 0; index < 14; index++) {
    const shifts = result.plans.map(({ plan }, person) => plan.changes.find((change) => change.index === index)?.to ??
      members[person].days[index]);
    assert.equal(shifts.filter(({ dayHours, nightHours }) => dayHours === 11 && nightHours === 0).length, 1);
    assert.equal(shifts.filter(({ nightHours }) => nightHours === 2 || nightHours === 7).length, 1);
  }
});

test("two-days two-nights template resumes its own cycle after the fourth operator returns", () => {
  const members = Array.from({ length: 4 }, (_, id) => ({ id, days: emptyMonth() }));
  for (let index = 0; index < 14; index++) members[3].days[index].leaveType = "ОТ";
  const result = planCoveredShiftCycle({ cycleId: "twoDaysTwoNights48", members, year: 2026, month: 9 });
  assert.equal(result.error, null);
  const returned = result.plans[3].plan.changes;
  assert.deepEqual([14, 15, 16, 17, 18, 19, 20, 21].map((index) => {
    const cell = returned.find((change) => change.index === index)?.to ?? members[3].days[index];
    return [cell.dayHours, cell.nightHours];
  }), [[11, 0], [11, 0], [0, 0], [0, 0], [2, 2], [4, 7], [2, 5], [0, 0]]);
});

test("two simultaneous absences leave one day and one night operator until return", () => {
  const members = Array.from({ length: 4 }, (_, id) => ({ id, days: emptyMonth() }));
  for (let index = 0; index < 14; index++) {
    members[2].days[index].leaveType = "Б";
    members[3].days[index].leaveType = "ОТ";
  }
  const result = planCoveredShiftCycle({ cycleId: "dayNight48", members, year: 2026, month: 9 });
  assert.equal(result.error, null);
  for (let index = 0; index < 14; index++) {
    const shifts = result.plans.map(({ plan }, person) => plan.changes.find((change) => change.index === index)?.to ??
      members[person].days[index]);
    assert.equal(shifts.filter(({ dayHours, nightHours }) => dayHours === 11 && nightHours === 0).length, 1);
    assert.equal(shifts.filter(({ nightHours }) => nightHours === 2 || nightHours === 7).length, 1);
  }
  assert.ok(result.plans.slice(2).every(({ plan }) => plan.changes.every(({ index }) => index >= 14)));
});

test("at the month boundary an available off-duty operator gets day priority", () => {
  const members = Array.from({ length: 4 }, (_, id) => ({ id, days: emptyMonth(),
    previousDay: [
      { dayHours: 11, nightHours: 0 },
      { dayHours: 0, nightHours: 0 },
      { dayHours: 2, nightHours: 5 },
      { dayHours: 11, nightHours: 0 },
    ][id] }));
  members[0].days[0].leaveType = "ОТ";
  const result = planCoveredShiftCycle({ cycleId: "dayNight48", members, year: 2026, month: 9 });
  assert.equal(result.error, null);
  assert.deepEqual(result.plans[1].plan.changes.find(({ index }) => index === 0).to,
    { dayHours: 11, nightHours: 0 });
});

test("a recognized prior cycle keeps the employee phase at the month boundary", () => {
  const previousDays = fullMonth("dayNight48", 0, 30);
  const members = Array.from({ length: 4 }, (_, index) => ({ id: index + 1, days: emptyMonth(),
    previousDays: index === 0 ? previousDays : null }));
  const result = planCoveredShiftCycle({ cycleId: "dayNight48", members, year: 2026, month: 9 });
  assert.equal(result.plans.find(({ id }) => id === 1).phase, inferNextShiftCyclePhase("dayNight48", previousDays));
  assert.deepEqual(result.gaps, []);
});

test("an odd two-night phase from the previous month still permits full coverage", () => {
  const previousDays = fullMonth("twoDaysTwoNights48", 3, 30);
  assert.equal(inferNextShiftCyclePhase("twoDaysTwoNights48", previousDays), 1);
  const members = Array.from({ length: 4 }, (_, index) => ({
    id: `employee-${index + 1}`,
    days: emptyMonth(),
    previousDays: index === 0 ? previousDays : null,
  }));
  const result = planCoveredShiftCycle({ cycleId: "twoDaysTwoNights48", members, year: 2026, month: 9 });
  assert.equal(result.plans.find(({ id }) => id === "employee-1").phase, 1);
  assert.deepEqual(result.gaps, []);
});

test("day/night cycle rolls through a night ending on the last day of a month", () => {
  const previous = fullMonth("dayNight48", 1, 30);
  assert.deepEqual(previous.at(-1), { dayHours: 2, nightHours: 5 });
  const firstPhase = inferNextShiftCyclePhase("dayNight48", previous);
  assert.equal(firstPhase, 3);

  const plan = planShiftCycle({ cycleId: "dayNight48", firstPhase, existingDays: emptyMonth() });
  assert.deepEqual(plan.changes.slice(0, 3).map(({ index, to }) => [index, to]), [
    [1, { dayHours: 11, nightHours: 0 }],
    [2, { dayHours: 2, nightHours: 2 }],
    [3, { dayHours: 2, nightHours: 5 }],
  ]);
  assert.equal(plan.conflicts.length, 0);
});

test("two-night cycle uses one full free day after the 2/5 rest day", () => {
  const cycle = SHIFT_CYCLES.twoDaysTwoNights48;
  assert.deepEqual(cycle.slice(4), [
    { dayHours: 2, nightHours: 2 },
    { dayHours: 4, nightHours: 7 },
    { dayHours: 2, nightHours: 5 },
    { dayHours: 0, nightHours: 0 },
  ]);
  const previous = fullMonth("twoDaysTwoNights48", 1, 31);
  assert.equal(inferNextShiftCyclePhase("twoDaysTwoNights48", previous), 0);
  const plan = planShiftCycle({ cycleId: "twoDaysTwoNights48", firstPhase: 6, existingDays: emptyMonth(30) });
  assert.deepEqual(plan.changes.slice(0, 2).map(({ index, to }) => [index, to]), [
    [0, { dayHours: 2, nightHours: 5 }],
    [2, { dayHours: 11, nightHours: 0 }],
  ]);
});

test("inconsistent previous schedule requires an explicit phase", () => {
  const previous = fullMonth("dayNight48", 0, 31);
  previous[30] = { dayHours: 8, nightHours: 0 };
  assert.equal(inferNextShiftCyclePhase("dayNight48", previous), null);
  assert.equal(inferNextShiftCyclePhase("twoDaysTwoNights48", previous), null);
});

test("planning reports occupied and absent dates without changing input", () => {
  const existingDays = emptyMonth(28);
  existingDays[0] = { dayHours: 8, nightHours: 0 };
  existingDays[1] = { dayHours: 0, nightHours: 0, leaveType: "vacation" };
  existingDays[2] = { dayHours: 0, nightHours: 0, comment: "Agreed change" };
  const snapshot = structuredClone(existingDays);

  const plan = planShiftCycle({ cycleId: "dayNight48", firstPhase: 0, existingDays });
  assert.deepEqual(plan.conflicts.map(({ index }) => index), [0, 1, 2]);
  assert.deepEqual(existingDays, snapshot);
  assert.ok(plan.changes.every(({ index }) => index > 2));
});

test("both cycles start after a mixed week, preserve it and honor rest after Friday night", () => {
  for (const cycleId of ["dayNight48", "twoDaysTwoNights48"]) {
    const members = mixedFirstWeek();
    const before = structuredClone(members);
    const result = planCoveredShiftCycle({ cycleId, members, year: 2026, month: 5 });
    assert.equal(result.error, null);
    assert.equal(result.startIndex, 5);
    assert.deepEqual(result.gaps, []);
    assert.deepEqual(members, before);
    assert.ok(result.plans.every(({ plan }) => plan.changes.every(({ index }) => index >= 5)));

    const FridayNight = result.plans.find(({ id }) => id === "employee-1");
    assert.ok(FridayNight.plan.changes.every(({ index }) => index !== 5 && index !== 6));
    const lowestHours = result.plans.find(({ id }) => id === "employee-2");
    assert.equal(lowestHours.plan.changes.find(({ index }) => index === 5)?.to.dayHours, 11);
  }
});

test("a manually filled future shift is never overwritten by the cycle", () => {
  const members = mixedFirstWeek();
  members[2].days[10] = { dayHours: 6, nightHours: 2 };
  const result = planCoveredShiftCycle({ cycleId: "dayNight48", members, year: 2026, month: 5 });
  assert.match(result.error, /нет подходящей фазы|не удалось распределить/);
  assert.deepEqual(members[2].days[10], { dayHours: 6, nightHours: 2 });
});

test("a larger team spreads automatically across phases after a partial month", () => {
  const members = Array.from({ length: 20 }, (_, index) => ({
    id: `employee-${index + 1}`,
    days: Array.from({ length: 30 }, (_, day) => ({ dayHours: day < 5 ? 8 : 0, nightHours: 0 })),
  }));
  for (const cycleId of ["dayNight48", "twoDaysTwoNights48"]) {
    const result = planCoveredShiftCycle({ cycleId, members, year: 2026, month: 5 });
    assert.equal(result.startIndex, 5);
    assert.deepEqual(result.gaps, []);
    assert.equal(result.plans.length, 20);
    assert.equal(new Set(result.plans.map(({ phase }) => phase)).size, 4);
    assert.deepEqual(planCoveredShiftCycle({ cycleId, members, year: 2026, month: 5 }), result);
  }
});

test("a fully staffed month has no automatic transition point", () => {
  const members = mixedFirstWeek();
  for (let day = 5; day < 30; day++) members[1].days[day] = { dayHours: 8, nightHours: 0 };
  const result = planCoveredShiftCycle({ cycleId: "dayNight48", members, year: 2026, month: 5 });
  assert.match(result.error, /нет свободного дня/);
  assert.deepEqual(result.plans, []);
});
