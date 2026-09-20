function pluralRu(value, one, few, many) {
  const number = Math.abs(Number(value)) % 100;
  const lastDigit = number % 10;
  if (number > 10 && number < 20) return many;
  if (lastDigit > 1 && lastDigit < 5) return few;
  if (lastDigit === 1) return one;
  return many;
}

export function formatEmploymentDuration({ years, months, days }) {
  const parts = [];
  if (years > 0) parts.push(`${years} ${pluralRu(years, "год", "года", "лет")}`);
  if (months > 0) parts.push(`${months} ${pluralRu(months, "месяц", "месяца", "месяцев")}`);
  if (days > 0 || !parts.length) parts.push(`${days} ${pluralRu(days, "день", "дня", "дней")}`);
  return parts.join(", ");
}

export function parseProfileDate(value) {
  const match = String(value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function addYearsClamped(date, years) {
  const year = date.getFullYear() + years;
  return new Date(year, date.getMonth(), Math.min(date.getDate(), daysInMonth(year, date.getMonth())));
}

function addMonthsClamped(date, months) {
  const totalMonth = date.getMonth() + months;
  const year = date.getFullYear() + Math.floor(totalMonth / 12);
  const month = ((totalMonth % 12) + 12) % 12;
  return new Date(year, month, Math.min(date.getDate(), daysInMonth(year, month)));
}

export function diffCalendarInclusive(startDate, endDate) {
  const endExclusive = addDays(endDate, 1);
  let years = endExclusive.getFullYear() - startDate.getFullYear();
  let anchor = addYearsClamped(startDate, years);
  if (anchor > endExclusive) {
    years -= 1;
    anchor = addYearsClamped(startDate, years);
  }

  let months = endExclusive.getMonth() - anchor.getMonth()
    + (endExclusive.getFullYear() - anchor.getFullYear()) * 12;
  let monthAnchor = addMonthsClamped(anchor, months);
  if (monthAnchor > endExclusive) {
    months -= 1;
    monthAnchor = addMonthsClamped(anchor, months);
  }

  const days = Math.max(0, Math.round((endExclusive - monthAnchor) / (24 * 60 * 60 * 1000)));
  return { years, months, days };
}
