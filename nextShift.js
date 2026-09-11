const EPSILON = 0.05;

function numberAt(values, index) {
  const value = Number(Array.isArray(values) ? values[index] : 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function sameHours(value, expected) {
  return Math.abs(value - expected) <= EPSILON;
}

function hasLeave(payload, index) {
  const value = Array.isArray(payload?.leaveType) ? payload.leaveType[index] : null;
  return typeof value === "string" ? Boolean(value.trim()) : Boolean(value);
}

function isNightRest(day, night) {
  return (sameHours(day, 1) || sameHours(day, 2)) && sameHours(night, 5);
}

function isNightShift(day, night) {
  return (sameHours(day, 2) && sameHours(night, 2)) ||
    ((sameHours(day, 3) || sameHours(day, 4)) && sameHours(night, 7));
}

function monthKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}`;
}

function dateAfter(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12);
}

function shiftAt(payload, index, nextPayload, nextIndex) {
  if (!payload || hasLeave(payload, index)) return null;

  const day = numberAt(payload.dayHours, index);
  const night = numberAt(payload.nightHours, index);
  if (!(day > 0 || night > 0) || isNightRest(day, night)) return null;

  if (isNightShift(day, night)) {
    let hours = sameHours(day, 3) ? 10 : 11;
    if (sameHours(day, 2) && sameHours(night, 2)) {
      const nextDay = numberAt(nextPayload?.dayHours, nextIndex);
      const nextNight = numberAt(nextPayload?.nightHours, nextIndex);
      if ((sameHours(nextDay, 1) && sameHours(nextNight, 5)) ||
          (sameHours(nextDay, 3) && sameHours(nextNight, 7))) {
        hours = 10;
      }
    }
    return { kind: "night", hours, label: `Ночная смена · ${hours} ч` };
  }

  const hours = Number((day + night).toFixed(2));
  return {
    kind: night > 0 ? "mixed" : "day",
    hours,
    label: `${night > 0 ? "Смена" : "Дневная смена"} · ${hours} ч`,
  };
}

export function findNextShift(months, startDate = new Date(), daysAhead = 62) {
  const payloads = new Map(
    (Array.isArray(months) ? months : [])
      .filter((entry) => entry?.payload)
      .map((entry) => [`${Number(entry.year)}-${Number(entry.month)}`, entry.payload])
  );
  const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 12);

  for (let offset = 0; offset <= daysAhead; offset += 1) {
    const date = dateAfter(start, offset);
    const nextDate = dateAfter(date, 1);
    const payload = payloads.get(monthKey(date));
    const nextPayload = payloads.get(monthKey(nextDate));
    const shift = shiftAt(payload, date.getDate() - 1, nextPayload, nextDate.getDate() - 1);
    if (shift) return { ...shift, date, daysUntil: offset };
  }

  return null;
}
