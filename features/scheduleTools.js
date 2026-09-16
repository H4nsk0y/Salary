const OFF = Object.freeze({ dayHours: 0, nightHours: 0 });
const DAY_8 = Object.freeze({ dayHours: 8, nightHours: 0 });
const EVENING_8 = Object.freeze({ dayHours: 6, nightHours: 2 });

function currentHours(day) {
  return {
    dayHours: Number(day?.dayHours ?? 0),
    nightHours: Number(day?.nightHours ?? 0),
  };
}

function isProtected(day) {
  return Boolean(day?.leaveType || String(day?.comment ?? "").trim() || day?.locked);
}

function isEmpty(day) {
  const value = currentHours(day);
  return !isProtected(day) && value.dayHours === 0 && value.nightHours === 0;
}

function isNightRest(day) {
  const value = currentHours(day);
  return value.dayHours === 2 && value.nightHours === 5;
}

function sameShift(a, b) {
  const value = currentHours(a);
  return value.dayHours === b.dayHours && value.nightHours === b.nightHours;
}

function planTargets(existingDays, targets, replaceWorked = false) {
  const changes = [];
  const conflicts = [];
  for (let index = 0; index < targets.length; index++) {
    const target = targets[index];
    const current = existingDays[index] ?? {};
    if (!isProtected(current) && sameShift(current, target)) continue;
    if (replaceWorked && !isProtected(current)) {
      changes.push({ index, from: currentHours(current), to: target });
      continue;
    }
    if (!isEmpty(current)) {
      conflicts.push({ index, current, expected: target });
    } else if (target !== OFF) {
      changes.push({ index, from: currentHours(current), to: target });
    }
  }
  return { changes, conflicts };
}

function validateMonth(year, month, existingDays) {
  const count = new Date(year, month + 1, 0).getDate();
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 0 || month > 11 ||
      !Array.isArray(existingDays) || existingDays.length !== count) {
    throw new RangeError("Expected a complete calendar month");
  }
}

function isWorkday(year, month, index, holiday, transferredOff) {
  const dayOfWeek = new Date(year, month, index + 1).getDay();
  return dayOfWeek !== 0 && dayOfWeek !== 6 && !holiday?.[index] && !transferredOff?.[index];
}

function mondayWeekIndex(year, month, index) {
  const date = new Date(Date.UTC(year, month, index + 1));
  const dayOfWeek = (date.getUTCDay() + 6) % 7;
  return Math.floor((date.getTime() - dayOfWeek * 86400000) / (7 * 86400000));
}

export function planEightHourTemplate({
  mode, year, month, existingDays, holiday = [], transferredOff = [], group = 0, replaceWorked = false,
}) {
  validateMonth(year, month, existingDays);
  if (mode !== "fiveTwo" && mode !== "alternating") throw new RangeError("Unknown eight-hour template");
  if (group !== 0 && group !== 1) throw new RangeError("Unknown group");

  const targets = existingDays.map((_, index) => {
    if (!isWorkday(year, month, index, holiday, transferredOff)) return OFF;
    if (mode === "fiveTwo") return DAY_8;
    return (mondayWeekIndex(year, month, index) + group) % 2 === 0 ? DAY_8 : EVENING_8;
  });
  return planTargets(existingDays, targets, replaceWorked);
}

function workedHours(days) {
  return days.reduce((total, day) => {
    const value = currentHours(day);
    return total + value.dayHours + value.nightHours;
  }, 0);
}

function additionSizes(deficit) {
  if (deficit <= 0) return [];
  if (Math.abs(deficit - 15) < 0.001) return [8, 11];
  const options = [];
  for (let count8 = 0; count8 <= Math.ceil(deficit / 8) + 1; count8++) {
    for (let count11 = 0; count11 <= Math.ceil(deficit / 11) + 1; count11++) {
      const total = count8 * 8 + count11 * 11;
      if (total < deficit || total === 0) continue;
      options.push({ sizes: [...Array(count8).fill(8), ...Array(count11).fill(11)], over: total - deficit });
    }
  }
  options.sort((a, b) => a.over - b.over || a.sizes.length - b.sizes.length);
  return options[0]?.sizes ?? [];
}

export function planFillToNorm({ existingDays, personalNorm, previousDay = null, dayLoad = [], year, month }) {
  if (!Array.isArray(existingDays) || !Number.isFinite(personalNorm) || personalNorm < 0) {
    throw new RangeError("Invalid timesheet or personal norm");
  }
  const before = workedHours(existingDays);
  const sizes = additionSizes(personalNorm - before);
  const available = [];
  for (let index = 0; index < existingDays.length; index++) {
    if (!isEmpty(existingDays[index])) continue;
    if (index === 0 && !previousDay) continue;
    const preceding = index ? existingDays[index - 1] : previousDay;
    if (Number(preceding?.nightHours ?? 0) > 0 && !isNightRest(preceding)) continue;
    available.push(index);
  }
  const weekend = (index) => {
    if (!Number.isInteger(year) || !Number.isInteger(month)) return false;
    const weekday = new Date(year, month, index + 1).getDay();
    return weekday === 0 || weekday === 6;
  };
  available.sort((a, b) => Number(weekend(a)) - Number(weekend(b)) ||
    (weekend(a) ? a - b : (Number(dayLoad[a]) || 0) - (Number(dayLoad[b]) || 0) || a - b));
  if (available.length < sizes.length) {
    return { changes: [], before, after: before, shortage: sizes.length - available.length };
  }
  const changes = sizes.map((size, position) => ({
    index: available[position],
    from: OFF,
    to: size === 8 ? DAY_8 : { dayHours: 11, nightHours: 0 },
  }));
  return { changes, before, after: before + sizes.reduce((sum, size) => sum + size, 0), shortage: 0 };
}

export function planReduceOvertime({ existingDays, personalNorm, coworkers = [] }) {
  if (!Array.isArray(existingDays) || !Number.isFinite(personalNorm) || personalNorm < 0) {
    throw new RangeError("Invalid timesheet or personal norm");
  }
  const before = workedHours(existingDays);
  let excess = before - personalNorm;
  const changes = [];
  if (excess < 3) return { changes, before, after: before };

  const candidates = existingDays.map((day, index) => ({ day, index })).filter(({ day, index }) => {
    const value = currentHours(day);
    return !isProtected(day) && value.nightHours === 0 && (value.dayHours === 8 || value.dayHours === 11) &&
      coworkers.some((coworker) => !coworker?.[index]?.leaveType && !coworker?.[index]?.locked &&
        Number(coworker?.[index]?.nightHours ?? 0) === 0 && Number(coworker?.[index]?.dayHours ?? 0) >= 8);
  });

  for (const { day, index } of candidates) {
    if (excess < 10) break;
    const size = currentHours(day).dayHours;
    if (size > excess + 1) continue;
    changes.push({ index, from: currentHours(day), to: OFF });
    excess -= size;
  }
  for (const { day, index } of candidates) {
    if (excess < 3) break;
    if (changes.some((change) => change.index === index)) continue;
    if (currentHours(day).dayHours !== 11) continue;
    changes.push({ index, from: currentHours(day), to: DAY_8 });
    excess -= 3;
  }
  return { changes, before, after: personalNorm + excess };
}

export function planTeamNormFills(members, { year, month } = {}) {
  const availableMembers = members.filter((member) => !member.excluded);
  const count = members[0]?.days?.length ?? 0;
  const dayLoad = Array.from({ length: count }, (_, index) => availableMembers.reduce((total, member) =>
    total + (Number(member.days[index]?.dayHours ?? 0) >= 8 && Number(member.days[index]?.nightHours ?? 0) === 0 ? 1 : 0), 0));

  return members.filter((member) => member.selected && !member.excluded).map((member) => {
    const plan = planFillToNorm({ existingDays: member.days, personalNorm: member.norm,
      previousDay: member.previousDay, dayLoad, year, month });
    for (const change of plan.changes) dayLoad[change.index]++;
    return { id: member.id, plan };
  });
}

export function planTeamOvertimeReductions(members) {
  const working = new Map(members.map((member) => [member.id, member.days.map((day) => ({ ...day }))]));
  const selected = members.filter((member) => member.selected && !member.excluded);
  selected.sort((a, b) => (workedHours(b.days) - b.norm) - (workedHours(a.days) - a.norm));
  const planned = new Map();

  for (const member of selected) {
    const coworkers = members.filter((other) => other.id !== member.id && !other.excluded)
      .map((other) => working.get(other.id));
    const plan = planReduceOvertime({ existingDays: working.get(member.id), personalNorm: member.norm, coworkers });
    for (const { index, to } of plan.changes) working.get(member.id)[index] = { ...working.get(member.id)[index], ...to };
    planned.set(member.id, plan);
  }
  return selected.map((member) => ({ id: member.id, plan: planned.get(member.id) }));
}
