import assert from "node:assert/strict";
import test from "node:test";

import { enforceDayCoverage } from "../js/features/dayCoverage.js";
import { planCoveredShiftCycle } from "../js/features/shiftCycles.js";

const blankMonth = () => Array.from({ length: 31 }, () => ({ dayHours: 0, nightHours: 0 }));

function appliedDays(members, plans) {
  const byId = new Map(plans.map(({ id, plan }) => [String(id), plan]));
  return members.map((member) => {
    const days = member.days.map((day) => ({ ...day }));
    for (const change of byId.get(String(member.id))?.changes ?? []) {
      days[change.index] = { ...days[change.index], ...change.to };
    }
    return days;
  });
}

test("warehouse day coverage extends both 2/2 planners to three or five loaders", () => {
  for (const cycleId of ["dayNight48", "twoDaysTwoNights48"]) {
    const members = Array.from({ length: 12 }, (_, index) => ({
      id: String(index),
      days: blankMonth(),
    }));
    const base = planCoveredShiftCycle({ cycleId, members, year: 2026, month: 9 });
    assert.equal(base.error, null, cycleId);
    const result = enforceDayCoverage({
      members,
      plans: base.plans,
      minimum: 3,
      boosted: 5,
      boostedIndices: [0],
      eligibleIds: members.map(({ id }) => id),
    });
    assert.equal(result.error, null, cycleId);
    const days = appliedDays(members, result.plans);
    assert.equal(days.filter((person) => person[0].dayHours >= 8 && person[0].nightHours === 0).length, 5);
    assert.ok(days.filter((person) => person[1].dayHours >= 8 && person[1].nightHours === 0).length >= 3);
  }
});

test("warehouse day coverage preserves absence codes", () => {
  const members = Array.from({ length: 4 }, (_, index) => ({ id: String(index), days: blankMonth() }));
  members[3].days[0].leaveType = "ОТ";
  const plans = members.map(({ id }) => ({ id, plan: { changes: [] } }));
  const result = enforceDayCoverage({
    members,
    plans,
    minimum: 3,
    boosted: 3,
    eligibleIds: members.map(({ id }) => id),
  });
  assert.equal(result.error, null);
  assert.equal(members[3].days[0].leaveType, "ОТ");
  assert.ok(!result.plans.find(({ id }) => id === "3").plan.changes.some(({ index }) => index === 0));
});
