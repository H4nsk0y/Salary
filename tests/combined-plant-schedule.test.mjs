import assert from 'node:assert/strict';
import test from 'node:test';
import { combinedPlantDemand, planCombinedPlantSchedule, startsCombinedNight } from '../js/features/combinedPlantSchedule.js';
const people = (year = 2026, month = 11, size = 4) => Array.from({ length: size }, (_, p) => ({
  id: String(p), name: `Оператор ${p}`, days: Array.from({ length: new Date(year, month + 1, 0).getDate() }, () => ({ dayHours: 0, nightHours: 0 })),
}));
const apply = (members, result) => members.map((member) => {
  const days = structuredClone(member.days);
  for (const change of result.plans.find((item) => item.id === member.id)?.plan.changes ?? []) days[change.index] = { ...days[change.index], ...change.to };
  return days;
});

for (const roundDays of [3, 4]) {
  test(`${roundDays}-day Odyssey cycle covers both plants without day-after-night or orphan night tails`, () => {
    const members = people();
    const result = planCombinedPlantSchedule({ members, year: 2026, month: 11, cycleStart: '2026-11-29', roundDays });
    assert.equal(result.error, null);
    const working = apply(members, result);
    for (let i = 0; i < 31; i++) {
      const need = combinedPlantDemand(2026, 11, i, '2026-11-29', roundDays);
      assert.ok(working.filter((days) => days[i].dayHours >= 10 && !days[i].nightHours).length >= need.day, `day ${i + 1}`);
      assert.ok(working.filter((days) => startsCombinedNight(days[i])).length >= need.night, `night ${i + 1}`);
      for (const days of working) {
        if (i && startsCombinedNight(days[i - 1])) {
          assert.ok((days[i].dayHours === 2 && days[i].nightHours === 5) || (days[i].dayHours === 4 && days[i].nightHours === 7));
        } else assert.notDeepEqual(days[i], { dayHours: 2, nightHours: 5 });
      }
    }
    assert.deepEqual(members, people());
    assert.equal(planCombinedPlantSchedule({ members: members.map((member, p) => ({ ...member, days: working[p] })), year: 2026, month: 11, cycleStart: '2026-11-29', roundDays }).plans.flatMap((item) => item.plan.changes).length, 0);
  });
}
test('six-day phase works before the anchor, across years, including weekends', () => {
  assert.equal(combinedPlantDemand(2026, 11, 30, '2027-01-02', 3).phase, 4);
  assert.deepEqual(combinedPlantDemand(2026, 11, 5, '2026-12-06', 3), { day: 1, night: 1, phase: 0 });
  assert.throws(() => combinedPlantDemand(2026, 11, 0, '2026-02-31', 3));
});
test('infeasible staffing returns no partial plans and a dated error', () => {
  const members = people(2026, 11, 3);
  const result = planCombinedPlantSchedule({ members, year: 2026, month: 11, cycleStart: '2026-12-01', roundDays: 4 });
  assert.match(result.error, /1-е число/);
  assert.deepEqual(result.plans, []);
});
test('absence and no-night restriction are preserved or block an impossible month', () => {
  const members = people();
  members[0].days[0].leaveType = 'vac_paid';
  const args = { members, year: 2026, month: 11, cycleStart: '2026-12-01', roundDays: 3 };
  assert.ok(planCombinedPlantSchedule(args).error);
  members[0].days[0].leaveType = null;
  members[0].noNight = true;
  const result = planCombinedPlantSchedule(args);
  if (!result.error) assert.ok(apply(members, result)[0].every((day) => day.nightHours === 0));
});
test('previous month night is completed and next month fixed daytime blocks a last-night start', () => {
  const members = people();
  members[0].previousDay = { dayHours: 2, nightHours: 2 };
  members[0].nextDay = { dayHours: 11, nightHours: 0 };
  const result = planCombinedPlantSchedule({ members, year: 2026, month: 11, cycleStart: '2026-12-01', roundDays: 3 });
  assert.equal(result.error, null);
  const days = apply(members, result)[0];
  assert.ok(days[0].nightHours >= 5);
  assert.equal(startsCombinedNight(days.at(-1)), false);
});
test('manual shifts and comments are never overwritten', () => {
  const members = people();
  members[0].days[0] = { dayHours: 11, nightHours: 0, comment: 'Не менять' };
  const result = planCombinedPlantSchedule({ members, year: 2026, month: 11, cycleStart: '2026-12-01', roundDays: 3 });
  assert.equal(result.error, null);
  assert.deepEqual(apply(members, result)[0][0], members[0].days[0]);
});
