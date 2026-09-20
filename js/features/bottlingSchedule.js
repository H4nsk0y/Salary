import { planAdaptiveCoverage } from "./adaptiveCoverage.js";

const OFF = { dayHours: 0, nightHours: 0 };
const DAY = { dayHours: 11, nightHours: 0 };
const NIGHT = { dayHours: 2, nightHours: 2 };
const REST = { dayHours: 2, nightHours: 5 };
const SECOND_NIGHT = { dayHours: 4, nightHours: 7 };

// Four complementary routes cover every weekday's day and night shift.
const ROUTES = [
  [DAY, NIGHT, REST, DAY, NIGHT, REST, OFF],
  [NIGHT, REST, DAY, NIGHT, REST, OFF, OFF],
  [OFF, DAY, NIGHT, REST, DAY, OFF, OFF],
  [OFF, DAY, OFF, DAY, DAY, OFF, OFF],
];

const shift = (day) => ({ dayHours: Number(day?.dayHours || 0), nightHours: Number(day?.nightHours || 0) });
const same = (a, b) => a.dayHours === b.dayHours && a.nightHours === b.nightHours;
const total = (days) => days.reduce((sum, day) => { const value = shift(day); return sum + value.dayHours + value.nightHours; }, 0);
const protectedDay = (day) => Boolean(day?.leaveType || day?.locked || String(day?.comment || "").trim());
const empty = (day) => !protectedDay(day) && same(shift(day), OFF);
const nightStart = (day) => same(shift(day), NIGHT) ||
  (shift(day).dayHours === 4 && shift(day).nightHours === 7);
const nightRest = (day) => same(shift(day), REST);
const active = (day) => !day?.leaveType && !nightRest(day) && !same(shift(day), OFF);
const weekday = (year, month, index) => new Date(year, month, index + 1).getDay();
const monday = (year, month, index) => index - (weekday(year, month, index) + 6) % 7;

function permutations(values) {
  if (!values.length) return [[]];
  return values.flatMap((value, index) => permutations(values.filter((_, other) => other !== index))
    .map((tail) => [value, ...tail]));
}

function stableScore(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function chooseSizes(deficit, count) {
  if (deficit <= 0) return [];
  let best = null;
  let partial = null;
  for (let eights = 0; eights <= count; eights++) {
    for (let elevens = 0; elevens + eights <= count; elevens++) {
      const sum = eights * 8 + elevens * 11;
      if (!sum) continue;
      const sizes = [...Array(eights).fill(8), ...Array(elevens).fill(11)];
      if (sum < deficit) {
        if (!partial || sum > partial.sum || (sum === partial.sum && sizes.length < partial.sizes.length)) {
          partial = { sizes, sum };
        }
      } else {
        const candidate = { sizes, over: sum - deficit };
        if (!best || candidate.over < best.over ||
            (candidate.over === best.over && candidate.sizes.length < best.sizes.length)) best = candidate;
      }
    }
  }
  return best?.over <= 6 ? best.sizes : partial?.sizes ?? [];
}

function intendedShift(route, index, weekStart, holiday, preceding, nextDay) {
  const target = ROUTES[route][index - weekStart];
  if (nightRest(target)) return nightStart(preceding) ? REST : OFF;
  if (holiday?.[index]) return OFF;
  if (target === NIGHT && nextDay?.leaveType) return OFF;
  return target;
}

function elevenStreak(days, index, value) {
  let length = value === 11 ? 1 : 0;
  for (let next = index - 1; next >= 0 && shift(days[next]).dayHours === 11 && !shift(days[next]).nightHours; next--) length++;
  for (let next = index + 1; next < days.length && shift(days[next]).dayHours === 11 && !shift(days[next]).nightHours; next++) length++;
  return length;
}

export function planBottlingSchedule({
  members,
  year,
  month,
  holiday = [],
  minimumDayCoverage = 1,
  boostedDayCoverage = minimumDayCoverage,
  boostedDayIndices = [],
  coverageEligibleIds = null,
}) {
  const count = new Date(year, month + 1, 0).getDate();
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 0 || month > 11 ||
      !Array.isArray(members) || members.some((member) => !Array.isArray(member.days) || member.days.length !== count)) {
    throw new RangeError("Expected a complete calendar month");
  }
  if (members.length < 2) return { plans: [], startIndex: null,
    error: "Выберите минимум двух сотрудников для графика от розлива." };

  const hasAbsences = members.some((member) => member.days.some((day) => day?.leaveType));
  const hasNightRestrictions = members.some((member) => member.noNight);
  const coverageMembers = members.length > 4 && !hasAbsences && !hasNightRestrictions ? members.slice(0, 4) : members;
  const adaptive = members.length !== 4 || hasAbsences || hasNightRestrictions
    ? planAdaptiveCoverage({ members: coverageMembers, year, month, weekdaysOnly: true, holiday }) : null;
  if (adaptive?.error) return adaptive;
  const startIndex = adaptive?.startIndex ?? Array.from({ length: count }, (_, index) => index).find((index) => {
    const day = weekday(year, month, index);
    return day > 0 && day < 6 && !holiday[index] && members.every((member) => !active(member.days[index]));
  });
  if (startIndex === undefined) return { plans: [], startIndex: null, error: "Нет свободного буднего дня для начала графика." };

  const working = members.map((member) => member.days.map((day) => ({ ...day })));
  const changes = members.map(() => []);
  const statistics = members.map(() => null);
  const seedOrder = [...members.keys()].sort((a, b) => stableScore(`${year}-${month}-${members[a].id}`) -
    stableScore(`${year}-${month}-${members[b].id}`));
  if (adaptive) {
    for (const item of adaptive.plans) {
      const person = members.findIndex((member) => String(member.id) === String(item.id));
      if (person < 0) continue;
      changes[person].push(...item.plan.changes);
      for (const { index, to } of item.plan.changes) working[person][index] = { ...working[person][index], ...to };
    }
  } else {
  for (const [person, member] of members.entries()) {
    if (!nightStart(member.previousDay)) continue;
    if (nightRest(working[person][0])) continue;
    if (!empty(working[person][0])) return { plans: [], startIndex,
      error: `${member.name || "Сотрудник"}: после ночи прошлого месяца первое число занято. Проверьте отсыпной вручную.` };
    changes[person].push({ index: 0, from: OFF, to: REST });
    working[person][0] = { ...working[person][0], ...REST };
  }
  let previousOrder = null;
  let hadFullMonday = false;

  for (let weekStart = monday(year, month, startIndex); weekStart < count; weekStart += 7) {
    const first = Math.max(weekStart, startIndex, 0);
    const last = Math.min(weekStart + 6, count - 1);
    const mondayInMonth = weekStart >= 0 && first === weekStart;
    const orderedByHours = [...seedOrder].sort((a, b) => total(working[a]) - total(working[b]) ||
      String(members[a].id).localeCompare(String(members[b].id)));
    const preferred = hadFullMonday && previousOrder
      ? [...previousOrder.slice(1), previousOrder[0]]
      : orderedByHours;
    let best = null;
    for (const order of permutations(seedOrder)) {
      let score = 0;
      let valid = true;
      const projected = Array(4).fill(null);
      for (let index = first; index <= last && valid; index++) {
        const offset = index - weekStart;
        for (let slot = 0; slot < 4; slot++) {
          const person = order[slot];
          const current = working[person][index];
          const previousIndex = index - 1;
          const preceding = index ? (previousIndex >= first ? projected[person] : working[person][previousIndex])
            : members[person].previousDay;
          const target = intendedShift(slot, index, weekStart, holiday, preceding, working[person][index + 1]);
          if (current?.leaveType) {
            if (nightStart(preceding)) { valid = false; break; }
            if (target !== OFF) score += 30;
            projected[person] = current;
            continue;
          }
          if (!empty(current) && !same(shift(current), target)) { valid = false; break; }
          projected[person] = empty(current) ? target : current;
          if (target === OFF || nightRest(target)) continue;
          if (nightStart(preceding)) { valid = false; break; }
          if (preceding && nightRest(preceding) && offset !== 0 && target === NIGHT) score += 2;
          if (first === startIndex && index === startIndex && preceding) {
            if (shift(preceding).dayHours >= 8 && target !== NIGHT) score += 20;
            if (same(shift(preceding), OFF) && target !== DAY) score += 4;
          }
        }
      }
      if (!valid) continue;
      for (let slot = 0; slot < 4; slot++) {
        score += order[slot] === preferred[slot] ? 0 : (hadFullMonday ? 100 : 3);
        if (mondayInMonth && !hadFullMonday && slot === 0) {
          score += (total(working[order[slot]]) - total(working[orderedByHours[0]])) / 3;
        }
      }
      if (!best || score < best.score) best = { order, score };
    }
    if (!best) return { plans: [], startIndex, error: `Неделя с ${Math.max(1, weekStart + 1)}-го числа не совместима с уже заполненными сменами или отдыхом после ночи.` };
    previousOrder = best.order;
    if (mondayInMonth) hadFullMonday = true;
    for (let index = first; index <= last; index++) {
      for (let slot = 0; slot < 4; slot++) {
        const person = best.order[slot];
        const preceding = index ? working[person][index - 1] : members[person].previousDay;
        const target = intendedShift(slot, index, weekStart, holiday, preceding, working[person][index + 1]);
        if (target === OFF || !empty(working[person][index])) continue;
        const from = shift(working[person][index]);
        changes[person].push({ index, from, to: target });
        working[person][index] = { ...working[person][index], ...target };
      }
    }
  }

  for (let index = startIndex; index < count; index++) {
    const day = weekday(year, month, index);
    if (day === 0 || day === 6 || holiday[index]) continue;
    for (const kind of ["day", "night"]) {
      const covered = working.some((days) => kind === "day" ?
        shift(days[index]).dayHours >= 8 && shift(days[index]).nightHours === 0 : nightStart(days[index]));
      if (covered) continue;
      const candidates = seedOrder.filter((person) => {
        if (!empty(working[person][index])) return false;
        const preceding = index ? working[person][index - 1] : members[person].previousDay;
        if (nightStart(preceding)) return false;
        return kind === "day" || (index + 1 < count && empty(working[person][index + 1]));
      }).sort((a, b) => total(working[a]) - total(working[b]) ||
        (kind === "day" ? elevenStreak(working[a], index, 11) - elevenStreak(working[b], index, 11) : 0) ||
        stableScore(`${year}-${month}-${index}-${members[a].id}`) - stableScore(`${year}-${month}-${index}-${members[b].id}`));
      if (!candidates.length && kind === "night" && index + 1 < count) {
        const secondNight = seedOrder.filter((person) => {
          const plannedRest = changes[person].find((change) => change.index === index && same(change.to, REST));
          return plannedRest && index > 0 && same(shift(working[person][index - 1]), NIGHT) &&
            empty(working[person][index + 1]);
        }).sort((a, b) => total(working[a]) - total(working[b]))[0];
        if (secondNight !== undefined) {
          changes[secondNight].find((change) => change.index === index).to = SECOND_NIGHT;
          working[secondNight][index] = { ...working[secondNight][index], ...SECOND_NIGHT };
          changes[secondNight].push({ index: index + 1, from: OFF, to: REST });
          working[secondNight][index + 1] = { ...working[secondNight][index + 1], ...REST };
          continue;
        }
      }
      if (!candidates.length && kind === "night" && index + 1 < count) {
        const dayCover = working.filter((days) => shift(days[index]).dayHours >= 8 && !shift(days[index]).nightHours).length;
        const convertible = dayCover > 1 ? seedOrder.find((person) =>
          changes[person].some((change) => change.index === index && same(change.to, DAY)) &&
          empty(working[person][index + 1]) &&
          !nightStart(index ? working[person][index - 1] : members[person].previousDay)) : undefined;
        if (convertible !== undefined) {
          changes[convertible].find((change) => change.index === index).to = NIGHT;
          working[convertible][index] = { ...working[convertible][index], ...NIGHT };
          changes[convertible].push({ index: index + 1, from: OFF, to: REST });
          working[convertible][index + 1] = { ...working[convertible][index + 1], ...REST };
          continue;
        }
      }
      if (!candidates.length) return { plans: [], startIndex,
        error: `${index + 1}-го числа не удалось закрыть ${kind === "day" ? "день" : "ночь"} с учётом отсутствий и уже заполненных смен.` };
      const person = candidates[0];
      const to = kind === "day" ? DAY : NIGHT;
      changes[person].push({ index, from: OFF, to });
      working[person][index] = { ...working[person][index], ...to };
      if (kind === "night") {
        changes[person].push({ index: index + 1, from: OFF, to: REST });
        working[person][index + 1] = { ...working[person][index + 1], ...REST };
      }
    }
  }
  }

  for (const [person, member] of members.entries()) {
    if (!nightStart(member.previousDay) || nightRest(working[person][0])) continue;
    if (!empty(working[person][0])) {
      return { plans: [], startIndex,
        error: `${member.name || "Сотрудник"}: после ночной смены прошлого месяца первое число занято.` };
    }
    changes[person].push({ index: 0, from: OFF, to: REST });
    working[person][0] = { ...working[person][0], ...REST };
  }

  const boosted = new Set(boostedDayIndices.map(Number));
  const eligibleIds = coverageEligibleIds == null
    ? new Set(members.map((member) => String(member.id)))
    : new Set(coverageEligibleIds.map(String));
  const eligiblePeople = seedOrder.filter((person) => eligibleIds.has(String(members[person].id)));
  const maximumRequired = boosted.size ? Math.max(minimumDayCoverage, boostedDayCoverage) : minimumDayCoverage;
  if (maximumRequired > eligiblePeople.length) {
    return { plans: [], startIndex,
      error: `Для выбранного режима нужно минимум ${maximumRequired} грузчиков, выбрано ${eligiblePeople.length}.` };
  }

  for (let index = startIndex; index < count; index++) {
    const dayOfWeek = weekday(year, month, index);
    if (dayOfWeek === 0 || dayOfWeek === 6 || holiday[index]) continue;
    const required = boosted.has(index) ? boostedDayCoverage : minimumDayCoverage;
    let covered = eligiblePeople.filter((person) =>
      shift(working[person][index]).dayHours >= 7 && !shift(working[person][index]).nightHours).length;
    if (covered >= required) continue;
    const candidates = eligiblePeople.filter((person) => {
      if (!empty(working[person][index])) return false;
      const preceding = index ? working[person][index - 1] : members[person].previousDay;
      return !nightStart(preceding);
    }).sort((a, b) => total(working[a]) - total(working[b]) ||
      elevenStreak(working[a], index, 11) - elevenStreak(working[b], index, 11) ||
      stableScore(`${year}-${month}-${index}-warehouse-${members[a].id}`) -
        stableScore(`${year}-${month}-${index}-warehouse-${members[b].id}`));
    while (covered < required && candidates.length) {
      const person = candidates.shift();
      changes[person].push({ index, from: OFF, to: DAY });
      working[person][index] = { ...working[person][index], ...DAY };
      covered++;
    }
    if (covered < required) {
      return { plans: [], startIndex,
        error: `${index + 1}-го числа не удалось поставить ${required} грузчиков в дневную смену: проверьте отсутствия и уже заполненные смены.` };
    }
  }

  // Keep supplemental shifts in the day unless that would create a long 11-hour run.
  for (const person of seedOrder) {
    const member = members[person];
    const before = total(member.days);
    const base = total(working[person]);
    const available = Array.from({ length: count }, (_, index) => index).filter((index) => {
      const day = weekday(year, month, index);
      if (index < startIndex || day === 0 || day === 6 || holiday[index] || !empty(working[person][index])) return false;
      const preceding = index ? working[person][index - 1] : member.previousDay;
      return !nightStart(preceding);
    }).sort((a, b) => Number(weekday(year, month, a) !== 1) - Number(weekday(year, month, b) !== 1) ||
      elevenStreak(working[person], a, 11) - elevenStreak(working[person], b, 11) || a - b);
    const sizes = chooseSizes(Number(member.norm) - base, available.length);
    for (const size of sizes) {
      const dayCandidates = available.filter((index) => empty(working[person][index]))
        .sort((a, b) => Number(size === 11 && elevenStreak(working[person], a, 11) >= 3) -
          Number(size === 11 && elevenStreak(working[person], b, 11) >= 3) ||
          Number(weekday(year, month, a) !== 1) - Number(weekday(year, month, b) !== 1) || a - b);
      const dayIndex = dayCandidates[0];
      if (dayIndex === undefined) break;
      const nightIndex = size === 11 && elevenStreak(working[person], dayIndex, 11) >= 3
        ? available.find((index) => !member.noNight && index + 1 < count && empty(working[person][index]) &&
          empty(working[person][index + 1]) &&
          working.filter((days) => nightStart(days[index])).length < 2 &&
          !nightStart(index ? working[person][index - 1] : member.previousDay))
        : undefined;
      if (nightIndex !== undefined) {
        changes[person].push({ index: nightIndex, from: OFF, to: NIGHT });
        changes[person].push({ index: nightIndex + 1, from: OFF, to: REST });
        working[person][nightIndex] = { ...working[person][nightIndex], ...NIGHT };
        working[person][nightIndex + 1] = { ...working[person][nightIndex + 1], ...REST };
      } else {
        const to = { dayHours: size, nightHours: 0 };
        changes[person].push({ index: dayIndex, from: OFF, to });
        working[person][dayIndex] = { ...working[person][dayIndex], ...to };
      }
    }
    const after = total(working[person]);
    statistics[person] = { before, after, shortage: Math.max(0, Number(member.norm) - after) };
  }
  const plans = members.map((member, index) => ({ id: member.id, plan: {
    changes: changes[index].sort((a, b) => a.index - b.index), ...statistics[index],
  } }));
  return { plans, startIndex, error: null };
}
