import { planAdaptiveCoverage } from "./adaptiveCoverage.js";

const OFF = Object.freeze({ dayHours: 0, nightHours: 0 });
const DAY = Object.freeze({ dayHours: 11, nightHours: 0 });
const NIGHT_START = Object.freeze({ dayHours: 2, nightHours: 2 });
const NIGHT_END = Object.freeze({ dayHours: 2, nightHours: 5 });
const SECOND_NIGHT = Object.freeze({ dayHours: 4, nightHours: 7 });

export const SHIFT_CYCLES = Object.freeze({
  dayNight48: Object.freeze([DAY, NIGHT_START, NIGHT_END, OFF]),
  twoDaysTwoNights48: Object.freeze([
    DAY, DAY, OFF, OFF, NIGHT_START, SECOND_NIGHT, NIGHT_END, OFF,
  ]),
});

function getCycle(cycleId) {
  const cycle = SHIFT_CYCLES[cycleId];
  if (!cycle) throw new RangeError(`Unknown shift cycle: ${cycleId}`);
  return cycle;
}

function hours(cell) {
  return {
    dayHours: Number(cell?.dayHours ?? 0),
    nightHours: Number(cell?.nightHours ?? 0),
  };
}

function matches(cell, shift) {
  const value = hours(cell);
  return !cell?.leaveType && !String(cell?.comment ?? "").trim() &&
    value.dayHours === shift.dayHours && value.nightHours === shift.nightHours;
}

export function inferNextShiftCyclePhase(cycleId, previousDays) {
  const cycle = getCycle(cycleId);
  if (!Array.isArray(previousDays) || previousDays.length < cycle.length) return null;
  const tail = previousDays.slice(-cycle.length);

  for (let nextPhase = 0; nextPhase < cycle.length; nextPhase++) {
    if (tail.every((cell, index) => matches(cell, cycle[(nextPhase + index) % cycle.length]))) {
      return nextPhase;
    }
  }
  return null;
}

export function planShiftCycle({ cycleId, firstPhase, existingDays, startIndex = 0 }) {
  const cycle = getCycle(cycleId);
  if (!Number.isInteger(firstPhase) || firstPhase < 0 || firstPhase >= cycle.length) {
    throw new RangeError("Invalid first shift-cycle phase");
  }
  if (!Array.isArray(existingDays) || existingDays.length < 28 || existingDays.length > 31) {
    throw new RangeError("Expected a complete calendar month");
  }
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= existingDays.length) {
    throw new RangeError("Invalid shift-cycle start date");
  }

  const changes = [];
  const conflicts = [];
  for (let index = startIndex; index < existingDays.length; index++) {
    const current = existingDays[index] ?? {};
    const expected = cycle[(firstPhase + index - startIndex) % cycle.length];
    if (matches(current, expected)) continue;

    const previous = hours(current);
    if (current.leaveType || current.locked || String(current.comment ?? "").trim() ||
        previous.dayHours !== 0 || previous.nightHours !== 0) {
      conflicts.push({ index, expected, current });
      continue;
    }
    if (expected === OFF) continue;
    changes.push({ index, from: previous, to: expected });
  }
  return { changes, conflicts };
}

function stableScore(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function startsNight(day) {
  const value = hours(day);
  return (value.dayHours === 2 && value.nightHours === 2) ||
    (value.dayHours === 4 && value.nightHours === 7);
}

function endsNight(day) {
  const value = hours(day);
  return !day?.leaveType && value.dayHours === 2 && value.nightHours >= 4;
}

function isActiveShift(day) {
  const value = hours(day);
  return !day?.leaveType && !endsNight(day) && (value.dayHours > 0 || value.nightHours > 0);
}

function totalHours(days) {
  return days.reduce((sum, day) => {
    const value = hours(day);
    return sum + value.dayHours + value.nightHours;
  }, 0);
}

function transitionStart(operators, dayCount) {
  for (let index = 0; index < dayCount; index++) {
    if (operators.every((member) => !isActiveShift(member.days[index]))) return index;
  }
  return null;
}

function lastNightBefore(days, startIndex) {
  for (let index = startIndex - 1; index >= Math.max(0, startIndex - 3); index--) {
    if (startsNight(days[index])) return index;
  }
  return -1;
}

function transitionCandidate(cycleId, member, phase, startIndex) {
  const cycle = getCycle(cycleId);
  const lastNight = lastNightBefore(member.days, startIndex);
  const firstShift = cycle[phase];
  // Continue an existing night across the boundary without inventing a new 2/5.
  if (lastNight === startIndex - 1 && !endsNight(firstShift)) return null;
  if (lastNight === startIndex - 2 && (firstShift.dayHours || firstShift.nightHours)) return null;
  if (cycleId === "twoDaysTwoNights48" && phase === 5) return null;

  const plan = planShiftCycle({ cycleId, firstPhase: phase, existingDays: member.days, startIndex });
  if (plan.conflicts.length) return null;
  if (endsNight(firstShift) && lastNight !== startIndex - 1) {
    plan.changes = plan.changes.filter((change) => change.index !== startIndex);
  }
  return plan;
}

function candidatesByHours(members, phase, candidates, seed) {
  const available = members.filter((member) => candidates.get(member.id)?.has(phase));
  const byHours = (a, b) => totalHours(a.days) - totalHours(b.days) ||
    stableScore(`${seed}-${a.id}`) - stableScore(`${seed}-${b.id}`);
  available.sort(byHours);
  if (!available.length) return available;
  const cutoff = totalHours(available[0].days) + 3;
  const nearEqual = available.filter((member) => totalHours(member.days) <= cutoff);
  nearEqual.sort((a, b) => stableScore(`${seed}-${a.id}`) - stableScore(`${seed}-${b.id}`));
  return [...nearEqual, ...available.filter((member) => totalHours(member.days) > cutoff)];
}

function planTransitionCycle({ cycleId, operators, year, month, startIndex }) {
  // Assign the first day's day and night coverage before the remaining phases.
  const preferredPhases = cycleId === "dayNight48" ? [0, 1, 2, 3] : [0, 4, 2, 6];
  const candidates = new Map(operators.map((member) => [member.id, new Map(
    getCycle(cycleId).map((_, phase) => [phase, transitionCandidate(cycleId, member, phase, startIndex)])
      .filter(([, plan]) => plan),
  )]));
  const chosen = new Map();
  const assigned = new Set();
  const seed = `${year}-${month}-${startIndex}-${cycleId}`;

  function cover(phaseIndex) {
    if (phaseIndex === preferredPhases.length) return true;
    const phase = preferredPhases[phaseIndex];
    for (const member of candidatesByHours(operators, phase, candidates, seed)) {
      if (assigned.has(member.id)) continue;
      assigned.add(member.id);
      chosen.set(member.id, phase);
      if (cover(phaseIndex + 1)) return true;
      assigned.delete(member.id);
      chosen.delete(member.id);
    }
    return false;
  }

  if (!cover(0)) {
    return { plans: [], gaps: [], startIndex,
      error: `С ${startIndex + 1}-го числа не удалось распределить операторов с учетом заполненных смен и отдыха после ночи.` };
  }

  const usage = new Map(preferredPhases.map((phase) => [phase, 1]));
  for (const member of operators) {
    if (assigned.has(member.id)) continue;
    const phase = [...preferredPhases]
      .filter((candidate) => candidates.get(member.id)?.has(candidate))
      .sort((a, b) => usage.get(a) - usage.get(b) ||
        stableScore(`${seed}-${member.id}-${a}`) - stableScore(`${seed}-${member.id}-${b}`))[0];
    if (phase === undefined) {
      return { plans: [], gaps: [], startIndex,
        error: `${member.name || "Сотрудник"}: нет подходящей фазы с ${startIndex + 1}-го числа. Проверьте уже заполненные смены.` };
    }
    chosen.set(member.id, phase);
    usage.set(phase, usage.get(phase) + 1);
  }

  const plans = operators.map((member) => ({ id: member.id, phase: chosen.get(member.id),
    plan: candidates.get(member.id).get(chosen.get(member.id)) }));
  const gaps = [];
  for (let index = startIndex; index < operators[0].days.length; index++) {
    const shifts = plans.map(({ id, plan }) => plan.changes.find((change) => change.index === index)?.to ??
      operators.find((member) => member.id === id).days[index]);
    if (!shifts.some((day) => hours(day).dayHours >= 8)) gaps.push({ index, kind: "day" });
    if (!shifts.some(startsNight)) gaps.push({ index, kind: "night" });
  }
  return { plans, gaps, startIndex, error: null };
}

export function planCoveredShiftCycle({ cycleId, members, year, month }) {
  const cycle = getCycle(cycleId);
  const preferredPhases = cycleId === "dayNight48" ? [0, 1, 2, 3] : [0, 2, 4, 6];
  const operators = members.filter((member) => !member.isLeader);
  const dayCount = new Date(year, month + 1, 0).getDate();
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 0 || month > 11 ||
      members.some((member) => !Array.isArray(member.days) || member.days.length !== dayCount)) {
    throw new RangeError("Expected a complete calendar month");
  }
  if (operators.length < 4 || operators.length === 4 &&
      operators.some((member) => member.days.some((day) => day?.leaveType))) {
    return planAdaptiveCoverage({ members: operators.map((member) => ({ ...member,
      previousDay: member.previousDay ?? member.previousDays?.at(-1),
    })), year, month, cycleId });
  }
  const startIndex = transitionStart(operators, dayCount);
  if (startIndex === null) {
    return { plans: [], gaps: [], error: "В этом месяце нет свободного дня для начала графика 2/2." };
  }
  if (startIndex > 0) return planTransitionCycle({ cycleId, operators, year, month, startIndex });

  const ordered = [...operators].sort((a, b) =>
    stableScore(`${year}-${month}-${a.id}`) - stableScore(`${year}-${month}-${b.id}`) || String(a.id).localeCompare(String(b.id)));
  const usage = new Map(cycle.map((_, phase) => [phase, 0]));
  const assigned = new Map();
  for (const member of ordered) {
    const preferred = member.previousDays ? inferNextShiftCyclePhase(cycleId, member.previousDays) : null;
    if (preferred === null) continue;
    assigned.set(member.id, preferred);
    usage.set(preferred, usage.get(preferred) + 1);
  }
  const missingMembers = ordered.length - assigned.size;
  const fixedPhases = [...assigned.values()];
  let requiredPhases = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < (1 << cycle.length); mask++) {
    const added = cycle.map((_, phase) => phase).filter((phase) => mask & (1 << phase));
    if (added.length > missingMembers) continue;
    const candidate = [...fixedPhases, ...added];
    const coversCycle = cycle.every((_, index) =>
      candidate.some((phase) => cycle[(phase + index) % cycle.length].dayHours >= 8) &&
      candidate.some((phase) => startsNight(cycle[(phase + index) % cycle.length])));
    if (!coversCycle) continue;
    const score = added.length * 100 + added.filter((phase) => !preferredPhases.includes(phase)).length * 10 + mask / 256;
    if (score < bestScore) {
      bestScore = score;
      requiredPhases = added;
    }
  }
  const phasePool = [...new Set([...fixedPhases, ...(requiredPhases ?? []), ...preferredPhases])];
  const plans = ordered.map((member) => {
    let phase = assigned.get(member.id);
    if (phase === undefined) {
      phase = requiredPhases?.shift() ?? [...phasePool].sort((a, b) => usage.get(a) - usage.get(b) || a - b)[0];
      usage.set(phase, usage.get(phase) + 1);
    }
    return { id: member.id, phase, plan: planShiftCycle({ cycleId, firstPhase: phase, existingDays: member.days }) };
  });
  const gaps = [];
  for (let index = 0; index < dayCount; index++) {
    const shifts = plans.map(({ id, plan }) => plan.changes.find((change) => change.index === index)?.to ??
      operators.find((member) => member.id === id).days[index]);
    if (!shifts.some((day) => hours(day).dayHours >= 8)) gaps.push({ index, kind: "day" });
    if (!shifts.some(startsNight)) gaps.push({ index, kind: "night" });
  }
  return { plans, gaps, startIndex: 0, error: null };
}
