const MOSCOW_UTC_OFFSET_HOURS = 3;
const EPSILON = 0.05;

function numberAt(values, index) {
  const value = Number(values?.[index]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function approximately(value, expected) {
  return Math.abs(Number(value) - Number(expected)) <= EPSILON;
}

function formatHours(value) {
  const rounded = Math.round(Number(value) * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(".", ",");
}

function hasNightStart(day, night) {
  return (
    (approximately(day, 2) && approximately(night, 2)) ||
    (approximately(day, 4) && approximately(night, 7))
  );
}

function hasPreviousNightStart(dayHours, nightHours, index) {
  if (index <= 0) return false;
  return hasNightStart(numberAt(dayHours, index - 1), numberAt(nightHours, index - 1));
}

function eventDescription(day, night, comment) {
  const parts = [];
  if (day > 0) parts.push(`Дневные часы: ${formatHours(day)}`);
  if (night > 0) parts.push(`Ночные часы: ${formatHours(night)}`);
  if (comment) parts.push(`Комментарий: ${comment}`);
  return parts.join("\n");
}

function timedEvent(year, month, day, startHour, endDayOffset, endHour, summary, description) {
  return {
    allDay: false,
    start: { year, month, day, hour: startHour, minute: 0 },
    end: { year, month, day: day + endDayOffset, hour: endHour, minute: 0 },
    summary,
    description,
  };
}

function allDayEvent(year, month, day, summary, description) {
  return {
    allDay: true,
    start: { year, month, day },
    end: { year, month, day: day + 1 },
    summary,
    description,
  };
}

export function buildShiftCalendarEvents({
  year,
  month,
  dayHours = [],
  nightHours = [],
  shiftComments = [],
} = {}) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 0 || m > 11) return [];

  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const events = [];

  for (let index = 0; index < daysInMonth; index += 1) {
    const day = numberAt(dayHours, index);
    const night = numberAt(nightHours, index);
    const comment = String(shiftComments?.[index] ?? "").trim().slice(0, 500);
    if (day <= 0 && night <= 0) continue;

    const calendarDay = index + 1;
    const description = eventDescription(day, night, comment);

    if (hasNightStart(day, night)) {
      events.push(timedEvent(y, m, calendarDay, 20, 1, 8, "Ночная смена", description));

      if (approximately(day, 4) && approximately(night, 7) && !hasPreviousNightStart(dayHours, nightHours, index)) {
        events.push(timedEvent(y, m, calendarDay, 0, 0, 8, "Окончание ночной смены", description));
      }
      continue;
    }

    if (approximately(day, 2) && approximately(night, 5)) {
      if (!hasPreviousNightStart(dayHours, nightHours, index)) {
        events.push(timedEvent(y, m, calendarDay, 0, 0, 8, "Ночная смена", description));
      }
      continue;
    }

    if (approximately(day, 6) && approximately(night, 2)) {
      events.push(timedEvent(y, m, calendarDay, 16, 1, 0, "Вечерняя смена", description));
      continue;
    }

    if (approximately(day, 11) && night === 0) {
      events.push(timedEvent(y, m, calendarDay, 8, 0, 20, "Дневная смена", description));
      continue;
    }

    const total = day + night;
    const summary = night > 0
      ? `Смена: ${formatHours(day)}/${formatHours(night)}`
      : `Дневная смена: ${formatHours(total)} ч`;
    events.push(allDayEvent(y, m, calendarDay, summary, description));
  }

  return events;
}

function pad(value, length = 2) {
  return String(value).padStart(length, "0");
}

function normalizeDateParts(parts) {
  const date = new Date(Date.UTC(parts.year, parts.month, parts.day, parts.hour ?? 0, parts.minute ?? 0));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

function formatDateValue(parts) {
  const value = normalizeDateParts(parts);
  return `${value.year}${pad(value.month + 1)}${pad(value.day)}`;
}

function formatUtcDateTime(parts) {
  const value = normalizeDateParts({
    ...parts,
    hour: (parts.hour ?? 0) - MOSCOW_UTC_OFFSET_HOURS,
  });
  return `${value.year}${pad(value.month + 1)}${pad(value.day)}T${pad(value.hour)}${pad(value.minute)}00Z`;
}

function escapeIcsText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

export function buildShiftCalendarIcs({
  year,
  month,
  dayHours,
  nightHours,
  shiftComments,
  calendarName = "График ALVISA SALARY",
  generatedAt = new Date(),
} = {}) {
  const events = buildShiftCalendarEvents({ year, month, dayHours, nightHours, shiftComments });
  const stamp = generatedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ALVISA SALARY//Personal schedule//RU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
  ];

  events.forEach((event, index) => {
    lines.push(
      "BEGIN:VEVENT",
      `UID:alvisa-${year}-${Number(month) + 1}-${index + 1}@h4nsk0y.ru`,
      `DTSTAMP:${stamp}`,
      event.allDay
        ? `DTSTART;VALUE=DATE:${formatDateValue(event.start)}`
        : `DTSTART:${formatUtcDateTime(event.start)}`,
      event.allDay
        ? `DTEND;VALUE=DATE:${formatDateValue(event.end)}`
        : `DTEND:${formatUtcDateTime(event.end)}`,
      `SUMMARY:${escapeIcsText(event.summary)}`,
      `DESCRIPTION:${escapeIcsText(event.description)}`,
      "END:VEVENT"
    );
  });

  lines.push("END:VCALENDAR");
  return { events, content: `${lines.join("\r\n")}\r\n` };
}

export function downloadShiftCalendar(options = {}) {
  const result = buildShiftCalendarIcs(options);
  if (!result.events.length) return result;

  const blob = new Blob([result.content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `alvisa-schedule-${options.year}-${pad(Number(options.month) + 1)}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return result;
}
