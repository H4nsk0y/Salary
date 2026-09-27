export const VACATION_MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

function validIsoDate(value, year) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match || Number(match[1]) !== year) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return { iso:match[0], month:month - 1, day };
}

export function buildDepartmentVacationCalendar(rows, year) {
  const normalizedYear = Number(year);
  const byDate = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const name = String(row?.display_name || "Сотрудник").trim() || "Сотрудник";
    const dates = Array.isArray(row?.vacation_dates) ? row.vacation_dates : [];
    for (const value of dates) {
      const parsed = validIsoDate(value, normalizedYear);
      if (!parsed) continue;
      if (!byDate.has(parsed.iso)) byDate.set(parsed.iso, new Set());
      byDate.get(parsed.iso).add(name);
    }
  }

  const months = VACATION_MONTH_NAMES.map((name, month) => {
    const daysInMonth = new Date(normalizedYear, month + 1, 0, 12).getDate();
    const firstWeekday = (new Date(normalizedYear, month, 1, 12).getDay() + 6) % 7;
    const days = Array.from({ length:daysInMonth }, (_, index) => {
      const day = index + 1;
      const iso = `${normalizedYear}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const people = [...(byDate.get(iso) || [])].sort((a, b) => a.localeCompare(b, "ru"));
      return { day, iso, people, count:people.length };
    });
    return { name, month, firstWeekday, days };
  });

  return { year:normalizedYear, months };
}

export function vacationDensityLevel(count) {
  const value = Number(count) || 0;
  if (value >= 3) return 3;
  if (value >= 2) return 2;
  if (value >= 1) return 1;
  return 0;
}
