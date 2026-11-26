const OFF = { dayHours: 0, nightHours: 0 };
const DAY = { dayHours: 11, nightHours: 0 };
const NIGHT = { dayHours: 2, nightHours: 2 };
const CONTINUED_NIGHT = { dayHours: 4, nightHours: 7 };
const REST = { dayHours: 2, nightHours: 5 };
const hours = (day) => ({ dayHours: Number(day?.dayHours || 0), nightHours: Number(day?.nightHours || 0) });
const same = (a, b) => a.dayHours === b.dayHours && a.nightHours === b.nightHours;
const protectedDay = (day) => Boolean(day?.leaveType || day?.locked || String(day?.comment || '').trim());
const blank = (day) => !protectedDay(day) && same(hours(day), OFF);
export const startsCombinedNight = (day) => !day?.leaveType &&
  (same(hours(day), NIGHT) || same(hours(day), CONTINUED_NIGHT));

function dateStamp(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return NaN;
  const stamp = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value ? stamp : NaN;
}

export function combinedPlantDemand(year, month, index, cycleStart, roundDays) {
  const anchor = dateStamp(cycleStart);
  if (!Number.isFinite(anchor) || ![3, 4].includes(roundDays)) throw new RangeError('Укажите дату начала цикла Одиссея.');
  const stamp = Date.UTC(year, month, index + 1);
  const phase = ((Math.round((stamp - anchor) / 86400000) % 6) + 6) % 6;
  const weekday = new Date(stamp).getUTCDay();
  const chateau = weekday >= 1 && weekday <= 5 ? 1 : 0;
  return { day: chateau + Number(phase <= roundDays), night: chateau + Number(phase < roundDays), phase };
}

function options(member, index, previousNight) {
  const current = member.days[index];
  const fixed = !blank(current);
  const targets = previousNight ? [['night', CONTINUED_NIGHT], ['off', REST]]
    : [['day', DAY], ['night', NIGHT], ['off', OFF]];
  return targets.flatMap(([role, target]) => {
    if (role === 'night' && member.noNight) return [];
    if (fixed) {
      if (current.leaveType || current.locked) return !previousNight && role === 'off' ? [{ role, target: hours(current) }] : [];
      if (!same(hours(current), target)) {
        // Existing full daytime shifts can use a reduced accounting norm.
        if (!(role === 'day' && hours(current).dayHours >= 10 && !hours(current).nightHours)) {
          if (!(role === 'off' && !previousNight && hours(current).dayHours < 10 && hours(current).nightHours === 0)) return [];
        }
      }
    }
    if (role === 'night') {
      const next = member.days[index + 1] ?? member.nextDay;
      const expected = [REST, CONTINUED_NIGHT];
      if (next && !blank(next) && (next.leaveType || next.locked || !expected.some((shift) => same(hours(next), shift)))) return [];
    }
    return [{ role, target: fixed ? hours(current) : target }];
  });
}

export function planCombinedPlantSchedule({ members, year, month, cycleStart, roundDays }) {
  const count = new Date(year, month + 1, 0).getDate();
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 0 || month > 11 ||
      !Array.isArray(members) || members.length > 8 || members.some((member) => member.days?.length !== count)) {
    throw new RangeError('Ожидается полный месяц и не более восьми сотрудников.');
  }
  const demand = Array.from({ length: count }, (_, index) => combinedPlantDemand(year, month, index, cycleStart, roundDays));
  const fail = (index) => ({ plans: [], error: `${index + 1}-е число: нужно ${demand[index].day} в день и ${demand[index].night} в ночь. Не хватает доступных сотрудников с учётом заполненных смен, отсутствий и отдыха после ночи.` });
  if (!members.length) return fail(0);
  let beam = [{ previous: members.map((member) => startsCombinedNight(member.previousDay)),
    totals: members.map(() => 0), changes: members.map(() => []), score: 0 }];
  for (let index = 0; index < count; index++) {
    const candidates = [];
    for (const node of beam) {
      const choices = members.map((member, person) => options(member, index, node.previous[person]));
      const selected = [];
      function assign(person, dayCount, nightCount) {
        if (dayCount + members.length - person < demand[index].day || nightCount + members.length - person < demand[index].night) return;
        if (person < members.length) {
          for (const choice of choices[person]) {
            if (blank(members[person].days[index]) &&
                (choice.role === 'day' && dayCount >= demand[index].day || choice.role === 'night' && nightCount >= demand[index].night)) continue;
            selected.push(choice);
            assign(person + 1, dayCount + Number(choice.role === 'day'), nightCount + Number(choice.role === 'night'));
            selected.pop();
          }
          return;
        }
        const previous = selected.map((choice) => choice.role === 'night');
        const totals = node.totals.map((total, p) => total + selected[p].target.dayHours + selected[p].target.nightHours);
        const changes = node.changes.map((items, p) => same(hours(members[p].days[index]), selected[p].target) ? items
          : [...items, { index, from: hours(members[p].days[index]), to: selected[p].target }]);
        const addedShifts = selected.filter((choice, p) => blank(members[p].days[index]) && choice.role !== 'off').length;
        const continuation = previous.filter((night, p) => night && node.previous[p]).length;
        const score = node.score + addedShifts * 100 + continuation * 2;
        candidates.push({ previous, totals, changes, score });
      }
      assign(0, 0, 0);
    }
    if (!candidates.length) return fail(index);
    const rank = (node) => node.score + (Math.max(...node.totals) - Math.min(...node.totals)) / 100;
    candidates.sort((a, b) => rank(a) - rank(b));
    const seen = new Set();
    beam = candidates.filter((node) => {
      const key = node.previous.map(Number).join('') + ':' + node.totals.map((value) => Math.floor(value / 22)).join(',');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 96);
  }
  const best = beam[0];
  return { plans: members.map((member, person) => ({ id: member.id, plan: { changes: best.changes[person] } })), error: null };
}
