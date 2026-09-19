const OFF = { dayHours: 0, nightHours: 0 };
const DAY = { dayHours: 11, nightHours: 0 };

const hours = (day) => ({
  dayHours: Number(day?.dayHours || 0),
  nightHours: Number(day?.nightHours || 0),
});
const startsNight = (day) => {
  const value = hours(day);
  return value.dayHours === 2 && value.nightHours === 2 ||
    value.dayHours === 4 && value.nightHours === 7;
};
const blank = (day) => {
  const value = hours(day);
  return !day?.leaveType && !day?.locked && !String(day?.comment || "").trim() &&
    value.dayHours === 0 && value.nightHours === 0;
};
const total = (days) => days.reduce((sum, day) => {
  const value = hours(day);
  return sum + value.dayHours + value.nightHours;
}, 0);

export function enforceDayCoverage({
  members,
  plans,
  minimum = 1,
  boosted = minimum,
  boostedIndices = [],
  eligibleIds = null,
  startIndex = 0,
}) {
  const planById = new Map((plans ?? []).map(({ id, plan }) => [String(id), {
    id,
    plan: { ...plan, changes: [...(plan?.changes ?? [])] },
  }]));
  const working = members.map((member) => member.days.map((day) => ({ ...day })));
  for (const [person, member] of members.entries()) {
    const item = planById.get(String(member.id));
    if (!item) continue;
    for (const change of item.plan.changes) {
      working[person][change.index] = { ...working[person][change.index], ...change.to };
    }
  }

  const allowed = eligibleIds == null
    ? new Set(members.map((member) => String(member.id)))
    : new Set(eligibleIds.map(String));
  const eligiblePeople = members.map((_, index) => index)
    .filter((index) => allowed.has(String(members[index].id)));
  const boostedSet = new Set(boostedIndices.map(Number));
  const maximum = boostedSet.size ? Math.max(minimum, boosted) : minimum;
  if (eligiblePeople.length < maximum) {
    return { plans: [], error: `Для выбранного режима нужно минимум ${maximum} грузчиков, выбрано ${eligiblePeople.length}.` };
  }

  const dayCount = members[0]?.days?.length ?? 0;
  for (let index = Math.max(0, startIndex); index < dayCount; index++) {
    const required = boostedSet.has(index) ? boosted : minimum;
    let covered = eligiblePeople.filter((person) => {
      const value = hours(working[person][index]);
      return value.dayHours >= 7 && value.nightHours === 0;
    }).length;
    const candidates = eligiblePeople.filter((person) => {
      if (!blank(working[person][index])) return false;
      const previous = index ? working[person][index - 1] : members[person].previousDay;
      return !startsNight(previous);
    }).sort((a, b) => total(working[a]) - total(working[b]) ||
      String(members[a].id).localeCompare(String(members[b].id)));

    while (covered < required && candidates.length) {
      const person = candidates.shift();
      const member = members[person];
      const item = planById.get(String(member.id)) ?? { id: member.id, plan: { changes: [] } };
      item.plan.changes.push({ index, from: OFF, to: DAY });
      planById.set(String(member.id), item);
      working[person][index] = { ...working[person][index], ...DAY };
      covered++;
    }
    if (covered < required) {
      return { plans: [], error: `${index + 1}-го числа не удалось поставить ${required} грузчиков в дневную смену: проверьте отсутствия и уже заполненные смены.` };
    }
  }

  const result = members.map((member) => planById.get(String(member.id)) ?? {
    id: member.id,
    plan: { changes: [] },
  });
  for (const item of result) item.plan.changes.sort((a, b) => a.index - b.index);
  return { plans: result, error: null };
}
