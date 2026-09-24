import { getSession } from "./auth.js";
import { loadTimesheet } from "./db.js";
import { findNextShift } from "./nextShift.js";
import { getYearReviewAvailability } from "./yearReviewAvailability.js";

function initializeRevealAnimations() {
  const elements = document.querySelectorAll(".reveal");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion || !("IntersectionObserver" in window)) {
    elements.forEach((element) => element.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12 });
  elements.forEach((element) => {
    const bounds = element.getBoundingClientRect();
    if (bounds.bottom >= 0 && bounds.top <= window.innerHeight * 1.1) {
      element.classList.add("is-visible");
      return;
    }
    observer.observe(element);
  });
}

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

async function showYearReview() {
  const link = document.getElementById("yearReviewLink");
  if (!link) return;
  const session = await getSession();
  if (!session) return;
  const availability = getYearReviewAvailability(new Date());
  if (!availability.visible) return;
  link.href = `year-review.html?year=${availability.year}`;
  link.hidden = false;
}

showNextShift().catch(() => {
  // The public home page stays unchanged when schedule data is unavailable.
});
showYearReview().catch(() => undefined);

initializeRevealAnimations();
