import { getSession } from "./auth.js";
import { loadTimesheet } from "./db.js";
import { findNextShift } from "./nextShift.js";

function monthRef(date, offset) {
  const value = new Date(date.getFullYear(), date.getMonth() + offset, 1, 12);
  return { year: value.getFullYear(), month: value.getMonth() };
}

function formatShiftDate(shift) {
  if (shift.daysUntil === 0) return "Сегодня";
  if (shift.daysUntil === 1) return "Завтра";
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "long",
  }).format(shift.date).replace(/^./, (letter) => letter.toUpperCase());
}

async function showNextShift() {
  const root = document.getElementById("homeNextShift");
  if (!root) return;

  const session = await getSession();
  if (!session) return;

  const now = new Date();
  const refs = [monthRef(now, 0), monthRef(now, 1), monthRef(now, 2)];
  const payloads = await Promise.all(refs.map(async ({ year, month }) => ({
    year,
    month,
    payload: await loadTimesheet(year, month),
  })));
  const shift = findNextShift(payloads, now);
  if (!shift) return;

  const date = root.querySelector("[data-next-shift-date]");
  const detail = root.querySelector("[data-next-shift-detail]");
  if (date) date.textContent = formatShiftDate(shift);
  if (detail) detail.textContent = shift.label;
  root.hidden = false;
}

showNextShift().catch(() => {
  // The public home page stays unchanged when schedule data is unavailable.
});

