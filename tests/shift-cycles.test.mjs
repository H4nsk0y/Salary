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

test("leader is excluded from cycle coverage and fewer than four operators are rejected", () => {
  const members = Array.from({ length: 4 }, (_, index) => ({ id: index + 1, days: emptyMonth(), isLeader: index === 0 }));
  const result = planCoveredShiftCycle({ cycleId: "dayNight48", members, year: 2026, month: 9 });
  assert.match(result.error, /минимум 4/);
  const fifth = { id: 5, days: emptyMonth(), isLeader: false };
  const covered = planCoveredShiftCycle({ cycleId: "dayNight48", members: [...members, fifth], year: 2026, month: 9 });
  assert.deepEqual(covered.gaps, []);
  assert.equal(covered.plans.length, 4);
});

test("existing absences cannot silently leave the department uncovered", () => {
  const members = Array.from({ length: 4 }, (_, index) => ({ id: index + 1, days: emptyMonth() }));
  for (const member of members) member.days[0] = { dayHours: 0, nightHours: 0, leaveType: "vacation" };
  const result = planCoveredShiftCycle({ cycleId: "dayNight48", members, year: 2026, month: 9 });
  assert.ok(result.gaps.some(({ index }) => index === 0));
  assert.ok(result.plans.some(({ plan }) => plan.conflicts.some(({ index }) => index === 0)));
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
