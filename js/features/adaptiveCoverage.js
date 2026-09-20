const OFF = { dayHours: 0, nightHours: 0 };
const DAY = { dayHours: 11, nightHours: 0 };
const NIGHT = { dayHours: 2, nightHours: 2 };
const SECOND_NIGHT = { dayHours: 4, nightHours: 7 };
const REST = { dayHours: 2, nightHours: 5 };
const TWO_DAYS_TWO_NIGHTS = [DAY, DAY, OFF, OFF, NIGHT, SECOND_NIGHT, REST, OFF];

const hours = (day) => ({ dayHours: Number(day?.dayHours || 0), nightHours: Number(day?.nightHours || 0) });
const same = (a, b) => a.dayHours === b.dayHours && a.nightHours === b.nightHours;
const startsNight = (day) => same(hours(day), NIGHT) || same(hours(day), SECOND_NIGHT);
const isRest = (day) => same(hours(day), REST);
const isDay = (day) => hours(day).dayHours >= 8 && hours(day).nightHours === 0 && !day?.leaveType;
const isActive = (day) => !day?.leaveType && (isDay(day) || startsNight(day));
const blank = (day) => !day?.leaveType && !day?.locked && !String(day?.comment || "").trim() && same(hours(day), OFF);
const sum = (days) => days.reduce((total, day) => total + hours(day).dayHours + hours(day).nightHours, 0);

function stamp(node, person, index, target) {
  const current = node.working[person][index];
  if (same(hours(current), target)) return true;
  if (!blank(current)) return false;
  node.working[person][index] = { ...current, ...target };
  node.changes[person].push({ index, from: OFF, to: target });
  return true;
}

function clone(node) {
  return {
    working: node.working.map((days) => [...days]),
    changes: node.changes.map((items) => [...items]),
    score: node.score,
    phases: node.phases ? [...node.phases] : null,
    phaseStart: node.phaseStart,
  };
}

function previousFor(members, node, person, index) {
  return index ? node.working[person][index - 1] : members[person].previousDay;
}

function operatorCount(count) {
  const form = new Intl.PluralRules("ru-RU").select(count);
  return `${count} ${form === "one" ? "оператор" : form === "few" ? "оператора" : "операторов"}`;
}

function preference(members, node, person, index, role, availableCount, weekdaysOnly, year, month, holiday) {
  const previous = previousFor(members, node, person, index);
  const previousHours = hours(previous);
  let previousWorkday = index - 1;
  if (weekdaysOnly) {
    while (previousWorkday >= 0) {
      const day = new Date(year, month, previousWorkday + 1).getDay();
      if (day > 0 && day < 6 && !holiday[previousWorkday]) break;
      previousWorkday--;
    }
  }
  const returning = previousWorkday >= 0 ? Boolean(members[person].days[previousWorkday]?.leaveType)
    : Boolean(members[person].previousDay?.leaveType);
  let value = sum(node.working[person]) / 8;
  if (role === "day") {
    if (returning) value -= 30;
    if (isRest(previous)) value -= availableCount === 3 ? 14 : 5;
    else if (same(previousHours, OFF)) value -= 9;
    else if (isDay(previous)) value += availableCount === 2 ? -5 : 10;
    if (index === 0) {
      if (same(previousHours, OFF)) value -= 20;
      else if (isRest(previous)) value -= 10;
    }
  } else if (isDay(previous)) value -= availableCount === 2 ? 0 : 14;
  else if (startsNight(previous)) value += availableCount === 2 ? -5 : 18;
  else if (isRest(previous)) value += 4;

  if (availableCount === 2 && weekdaysOnly) {
    const dayOfWeek = new Date(year, month, index + 1).getDay();
    const priorFriday = dayOfWeek === 1 ? index - 3 : index - 1;
    if (priorFriday >= 0) {
      const prior = node.working[person][priorFriday];
      if (dayOfWeek === 1) {
        if (role === "day" && startsNight(prior) || role === "night" && isDay(prior)) value -= 30;
        if (role === "day" && isDay(prior) || role === "night" && startsNight(prior)) value += 30;
      } else {
        if (role === "day" && isDay(prior) || role === "night" && startsNight(prior)) value -= 30;
        if (role === "day" && startsNight(prior) || role === "night" && isDay(prior)) value += 30;
      }
    }
  }
  return value;
}

function validPair(members, node, index, dayPerson, nightPerson) {
  const current = node.working;
  const dayCell = current[dayPerson][index];
  const nightCell = current[nightPerson][index];
  const nightPrevious = previousFor(members, node, nightPerson, index);
  const nightTarget = startsNight(nightPrevious) ? SECOND_NIGHT : NIGHT;
  if (startsNight(previousFor(members, node, dayPerson, index))) return false;
  if (!blank(dayCell) && !isDay(dayCell)) return false;
  if (!blank(nightCell) && !startsNight(nightCell)) return false;
  if (index + 1 < current[0].length && node.working[nightPerson][index + 1]?.leaveType) return false;
  for (let person = 0; person < members.length; person++) {
    if (person === nightPerson || !startsNight(previousFor(members, node, person, index))) continue;
    const cell = current[person][index];
    if (cell?.leaveType || !blank(cell) && !isRest(cell)) return false;
  }
  return { nightTarget };
}

function applyPair(members, node, index, dayPerson, nightPerson, nightTarget) {
  const next = clone(node);
  if (!isDay(next.working[dayPerson][index]) && !stamp(next, dayPerson, index, DAY)) return null;
  if (!startsNight(next.working[nightPerson][index]) && !stamp(next, nightPerson, index, nightTarget)) return null;
  for (let person = 0; person < members.length; person++) {
    if (person === nightPerson || !startsNight(previousFor(members, node, person, index))) continue;
    if (!stamp(next, person, index, REST)) return null;
  }
  return next;
}

export function planAdaptiveCoverage({ members, year, month, weekdaysOnly = false, holiday = [], cycleId = "dayNight48" }) {
  const count = new Date(year, month + 1, 0).getDate();
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 0 || month > 11 ||
      !Array.isArray(members) || members.some((member) => !Array.isArray(member.days) || member.days.length !== count)) {
    throw new RangeError("Expected a complete calendar month");
  }
  if (members.length < 2) return { plans: [], gaps: [], startIndex: null,
    error: "Для дневной и ночной смены нужны хотя бы два оператора." };
  const workday = (index) => {
    if (!weekdaysOnly) return true;
    const day = new Date(year, month, index + 1).getDay();
    return day > 0 && day < 6 && !holiday[index];
  };
  const startIndex = Array.from({ length: count }, (_, index) => index)
    .find((index) => workday(index) && members.every((member) => !isActive(member.days[index])));
  if (startIndex === undefined) return { plans: [], gaps: [], startIndex: null,
    error: "Нет свободного дня для начала заполнения графика." };

  let nodes = [{ working: members.map((member) => member.days.map((day) => ({ ...day }))),
    changes: members.map(() => []), score: 0, phases: null, phaseStart: null }];
  for (let index = 0; index < count; index++) {
    if (index < startIndex) {
      nodes = nodes.map((node) => {
        const next = clone(node);
        for (let person = 0; person < members.length; person++) {
          if (!startsNight(previousFor(members, next, person, index))) continue;
          if (blank(next.working[person][index]) && !stamp(next, person, index, REST)) return null;
          if (index === 0 && next.working[person][index]?.leaveType) return null;
        }
        return next;
      }).filter(Boolean);
      if (!nodes.length) return { plans: [], gaps: [], startIndex,
        error: "После ночи перед началом графика некуда поставить отсыпной. Проверьте заполненные даты." };
      continue;
    }
    if (!workday(index)) {
      nodes = nodes.map((node) => {
        const next = clone(node);
        for (let person = 0; person < members.length; person++) {
          if (startsNight(previousFor(members, next, person, index))) {
            if (!stamp(next, person, index, REST)) return null;
          }
        }
        return next;
      }).filter(Boolean);
      if (!nodes.length) return { plans: [], gaps: [], startIndex,
        error: `${index + 1}-го числа отсыпной после ночи пересекается с кодом отсутствия или заполненной сменой.` };
      continue;
    }
    const expanded = [];
    for (const node of nodes) {
      const available = members.map((_, person) => person).filter((person) =>
        !node.working[person][index]?.leaveType &&
        (!node.working[person][index]?.locked || isActive(node.working[person][index])));
      if (available.length < 2) continue;
      const strictTwoNightCycle = cycleId === "twoDaysTwoNights48" && members.every((member) => !member.noNight);
      const continuingTwoNightCycle = strictTwoNightCycle && available.length === 4 &&
        node.phases && node.phaseStart !== null;
      for (const dayPerson of available) for (const nightPerson of available) {
        if (dayPerson === nightPerson) continue;
        if (members[nightPerson]?.noNight) continue;
        if (continuingTwoNightCycle) {
          const expected = (person) => TWO_DAYS_TWO_NIGHTS[(node.phases[person] + index - node.phaseStart) % 8];
          if (expected(dayPerson) !== DAY || ![NIGHT, SECOND_NIGHT].includes(expected(nightPerson))) continue;
        }
        const pair = validPair(members, node, index, dayPerson, nightPerson);
        if (!pair) continue;
        const next = applyPair(members, node, index, dayPerson, nightPerson, pair.nightTarget);
        if (!next) continue;
        if (strictTwoNightCycle && available.length === 4 && !continuingTwoNightCycle) {
          const others = available.filter((person) => person !== dayPerson && person !== nightPerson);
          others.sort((a, b) => Number(startsNight(previousFor(members, node, b, index))) -
            Number(startsNight(previousFor(members, node, a, index))));
          next.phases = Array(members.length).fill(null);
          next.phases[dayPerson] = 0;
          next.phases[nightPerson] = 4;
          next.phases[others[0]] = 6;
          next.phases[others[1]] = 2;
          next.phaseStart = index;
        } else if (available.length !== 4) {
          next.phases = null;
          next.phaseStart = null;
        }
        next.score += preference(members, node, dayPerson, index, "day", available.length, weekdaysOnly, year, month, holiday) +
          preference(members, node, nightPerson, index, "night", available.length, weekdaysOnly, year, month, holiday);
        if (startsNight(previousFor(members, node, nightPerson, index)) && available.length > 2 &&
            !(continuingTwoNightCycle && pair.nightTarget === SECOND_NIGHT)) next.score += 45;
        expanded.push(next);
      }
    }
    if (!expanded.length) {
      const eligible = members.filter((member) => !member.days[index]?.leaveType).length;
      const nightEligible = members.filter((member) => !member.noNight && !member.days[index]?.leaveType).length;
      return { plans: [], gaps: [], startIndex,
        error: eligible > 0 && nightEligible === 0
          ? `${index + 1}-го числа нет доступного сотрудника, которому разрешена ночная смена.`
          : `${index + 1}-го числа доступно ${operatorCount(eligible)}; не получается закрыть день и ночь без выхода из ночи в день или изменения уже заполненных ячеек.` };
    }
    expanded.sort((a, b) => a.score - b.score);
    nodes = expanded.slice(0, 48);
  }
  const best = nodes[0];
  const plans = members.map((member, person) => ({ id: member.id, plan: {
    changes: best.changes[person].sort((a, b) => a.index - b.index),
  } }));
  return { plans, gaps: [], startIndex, error: null };
}
