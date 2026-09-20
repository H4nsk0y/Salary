const EPSILON = 0.01;

function sameHours(value, expected) {
  return Math.abs((Number(value) || 0) - expected) < EPSILON;
}

function isNightStart(day, night) {
  return sameHours(day, 2) && sameHours(night, 2);
}

function isNightContinuation(day, night) {
  return (sameHours(day, 4) || sameHours(day, 3)) && sameHours(night, 7);
}

function isNightRest(day, night) {
  return (sameHours(day, 2) || sameHours(day, 1)) && sameHours(night, 5);
}

export function getNightSequenceDisplay(dayHours, nightHours, index) {
  const day = Number(dayHours?.[index]) || 0;
  const night = Number(nightHours?.[index]) || 0;

  if (isNightRest(day, night)) {
    return { kind: "rest", label: "Отсыпной", compactLabel: "Отс." };
  }

  if (isNightContinuation(day, night)) {
    const hours = sameHours(day, 3) ? 10 : 11;
    return { kind: "night", hours, label: `Ночная смена · ${hours} ч`, compactLabel: `Н ${hours}` };
  }

  if (isNightStart(day, night)) {
    const nextDay = Number(dayHours?.[index + 1]) || 0;
    const nextNight = Number(nightHours?.[index + 1]) || 0;
    const femalePattern =
      (sameHours(nextDay, 1) && sameHours(nextNight, 5)) ||
      (sameHours(nextDay, 3) && sameHours(nextNight, 7));
    const hours = femalePattern ? 10 : 11;
    return { kind: "night", hours, label: `Ночная смена · ${hours} ч`, compactLabel: `Н ${hours}` };
  }

  return null;
}

export function isWorkDepartureDay(dayHours, nightHours, leaveType, index) {
  if (leaveType?.[index]) return false;
  const sequence = getNightSequenceDisplay(dayHours, nightHours, index);
  if (sequence?.kind === "rest") return false;
  return (Number(dayHours?.[index]) || 0) > 0 || (Number(nightHours?.[index]) || 0) > 0;
}
