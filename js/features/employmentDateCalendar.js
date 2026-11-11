import { parseProfileDate } from "./employmentDuration.js";

const MIN_YEAR = 1950;
const monthLabel = new Intl.DateTimeFormat("ru-RU", { month: "long" });
const dayLabel = new Intl.DateTimeFormat("ru-RU", { dateStyle: "full" });
const twoDigits = (number) => String(number).padStart(2, "0");

export function normalizeEmploymentDateInput(value) {
  const text = String(value ?? "").trim();
  const local = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text) || /^(\d{2})(\d{2})(\d{4})$/.exec(text);
  const iso = local ? `${local[3]}-${local[2]}-${local[1]}` : text;
  return parseProfileDate(iso) ? iso : "";
}

export function formatEmploymentDateInput(value) {
  const iso = normalizeEmploymentDateInput(value);
  return iso ? iso.split("-").reverse().join(".") : "";
}

export function bindEmploymentDateCalendar(input, opener, dialog) {
  if (!input || !opener || !dialog) return;
  const monthSelect = dialog.querySelector("[data-calendar-month]");
  const yearSelect = dialog.querySelector("[data-calendar-year]");
  const previous = dialog.querySelector("[data-calendar-prev]");
  const next = dialog.querySelector("[data-calendar-next]");
  const days = dialog.querySelector("[data-calendar-days]");
  const minimum = new Date(MIN_YEAR, 0, 1);
  let today;
  let selected;
  let cursor;

  const startOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1);
  const addMonths = (date, amount) => new Date(date.getFullYear(), date.getMonth() + amount, 1);
  const clamp = (date) => date < minimum ? minimum : date > today ? today : date;

  function render({ focus = false } = {}) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = startOfMonth(cursor);
    yearSelect.value = String(year);
    monthSelect.value = String(month);
    for (const option of monthSelect.options) {
      option.disabled = year === today.getFullYear() && Number(option.value) > today.getMonth();
    }
    previous.disabled = first <= minimum;
    next.disabled = addMonths(cursor, 1) > today;
    days.replaceChildren();
    const offset = (first.getDay() + 6) % 7;
    const length = new Date(year, month + 1, 0).getDate();
    let focusedDay;
    for (let day = 1; day <= length; day += 1) {
      const date = new Date(year, month, day);
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = String(day);
      button.dataset.day = String(day);
      button.disabled = date > today;
      button.setAttribute("aria-label", dayLabel.format(date));
      button.setAttribute("aria-pressed", String(selected?.getTime() === date.getTime()));
      if (date.getTime() === today.getTime()) button.setAttribute("aria-current", "date");
      if (day === 1) button.style.gridColumnStart = String(offset + 1);
      button.tabIndex = day === cursor.getDate() ? 0 : -1;
      if (button.tabIndex === 0) focusedDay = button;
      days.append(button);
    }
    if (focus) focusedDay?.focus();
  }

  for (let month = 0; month < 12; month += 1) {
    const label = monthLabel.format(new Date(2000, month, 1));
    monthSelect.add(new Option(label, String(month)));
  }
  opener.addEventListener("click", () => {
    today = new Date();
    today.setHours(0, 0, 0, 0);
    selected = parseProfileDate(normalizeEmploymentDateInput(input.value));
    cursor = clamp(selected ?? today);
    yearSelect.replaceChildren();
    for (let year = today.getFullYear(); year >= MIN_YEAR; year -= 1) {
      yearSelect.add(new Option(String(year), String(year)));
    }
    render();
    dialog.showModal();
    days.querySelector('[tabindex="0"]')?.focus();
  });
  previous.addEventListener("click", () => { cursor = addMonths(cursor, -1); render(); if (previous.disabled) monthSelect.focus(); });
  next.addEventListener("click", () => { cursor = addMonths(cursor, 1); render(); if (next.disabled) monthSelect.focus(); });
  const changePeriod = () => {
    cursor = clamp(new Date(Number(yearSelect.value), Number(monthSelect.value), 1));
    render();
  };
  monthSelect.addEventListener("change", changePeriod);
  yearSelect.addEventListener("change", changePeriod);
  days.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-day]");
    if (!button || button.disabled) return;
    input.value = `${twoDigits(Number(button.dataset.day))}.${twoDigits(cursor.getMonth() + 1)}.${cursor.getFullYear()}`;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    dialog.close();
  });
  days.addEventListener("keydown", (event) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    const day = Number(event.target.dataset.day);
    if (!step || !day) return;
    event.preventDefault();
    cursor = clamp(new Date(cursor.getFullYear(), cursor.getMonth(), day + step));
    render({ focus: true });
  });
  dialog.querySelector("[data-calendar-close]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener("close", () => opener.focus({ preventScroll: true }));
}
