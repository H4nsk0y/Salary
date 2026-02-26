// /table.js
const prefersReducedMotion =
  window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function bump(el) {
  if (prefersReducedMotion || !el) return;
  el.classList.remove("pop");
  // eslint-disable-next-line no-unused-expressions
  el.offsetWidth;
  el.classList.add("pop");
}

function animateNumber(el, to, formatter, durationMs = 520) {
  if (!el) return;

  if (prefersReducedMotion || !Number.isFinite(to)) {
    el.textContent = formatter(to);
    el.dataset.value = String(to);
    return;
  }

  const from = Number.isFinite(Number(el.dataset.value)) ? Number(el.dataset.value) : 0;
  if (Math.abs(to - from) < 0.01) {
    el.textContent = formatter(to);
    el.dataset.value = String(to);
    return;
  }

  const start = performance.now();

  function tick(now) {
    const t = Math.min(1, (now - start) / durationMs);
    const k = easeOutCubic(t);
    const v = from + (to - from) * k;

    el.textContent = formatter(v);
    if (t < 1) requestAnimationFrame(tick);
    else {
      el.textContent = formatter(to);
      el.dataset.value = String(to);
    }
  }

  requestAnimationFrame(tick);
}

function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(1);
}

document.body.classList.add("is-loaded");

const today = new Date();
const currentYear = today.getFullYear();
const currentMonth = today.getMonth();

const monthNames = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

document.getElementById("monthYearDisplay").textContent =
  `${monthNames[currentMonth]} ${currentYear}`;

const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

let dayHours = new Array(daysInMonth).fill(0);
let nightHours = new Array(daysInMonth).fill(0);
let isHoliday = new Array(daysInMonth).fill(false);

const headerRow = document.getElementById("headerRow");
const dayRow = document.getElementById("dayRow");
const nightRow = document.getElementById("nightRow");

const headerCells = [];
const dayCells = [];
const nightCells = [];

const emptyTh = document.createElement("th");
emptyTh.textContent = "";
headerRow.appendChild(emptyTh);

for (let i = 1; i <= daysInMonth; i++) {
  const th = document.createElement("th");
  th.textContent = i;
  th.dataset.dayIndex = i - 1;

  th.style.cursor = "pointer";
  th.title = "Тап/клик — праздник";

  const dayOfWeek = new Date(currentYear, currentMonth, i).getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) th.classList.add("weekend-col");

  // ✅ ЛКМ/тап
  th.addEventListener("click", (e) => {
    const index = parseInt(e.currentTarget.dataset.dayIndex, 10);
    toggleHoliday(index);
  });

  headerRow.appendChild(th);
  headerCells.push(th);
}

const dayLabelCell = document.createElement("td");
dayLabelCell.textContent = "День";
dayLabelCell.style.fontWeight = "500";
dayRow.appendChild(dayLabelCell);

for (let i = 0; i < daysInMonth; i++) {
  const td = document.createElement("td");
  td.dataset.dayIndex = i;

  const dayOfWeek = new Date(currentYear, currentMonth, i + 1).getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) td.classList.add("weekend-col");

  const input = document.createElement("input");
  input.type = "number";
  input.min = 0;
  input.step = 0.5;
  input.classList.add("input-hour", "input-glass");
  input.addEventListener("input", (e) => {
    dayHours[i] = parseFloat(e.target.value) || 0;
    calculateTotals();
  });

  td.appendChild(input);
  dayRow.appendChild(td);
  dayCells.push(td);
}

const nightLabelCell = document.createElement("td");
nightLabelCell.textContent = "Ночь";
nightLabelCell.style.fontWeight = "500";
nightRow.appendChild(nightLabelCell);

for (let i = 0; i < daysInMonth; i++) {
  const td = document.createElement("td");

  const dayOfWeek = new Date(currentYear, currentMonth, i + 1).getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) td.classList.add("weekend-col");

  const input = document.createElement("input");
  input.type = "number";
  input.min = 0;
  input.step = 0.5;
  input.classList.add("input-hour", "input-glass");
  input.addEventListener("input", (e) => {
    nightHours[i] = parseFloat(e.target.value) || 0;
    calculateTotals();
  });

  td.appendChild(input);
  nightRow.appendChild(td);
  nightCells.push(td);
}

function toggleHoliday(index) {
  if (index < 0 || index >= daysInMonth) return;

  isHoliday[index] = !isHoliday[index];

  const elements = [headerCells[index], dayCells[index], nightCells[index]];
  elements.forEach((el) => {
    if (isHoliday[index]) el.classList.add("holiday-col");
    else el.classList.remove("holiday-col");
  });

  calculateTotals();
}

const totalHoursEl = document.getElementById("totalHours");
const dayNightHoursEl = document.getElementById("dayNightHours");
const normHoursEl = document.getElementById("normHours");
const overtimeEl = document.getElementById("overtime");

function calculateTotals() {
  let totalDay = 0;
  let totalNight = 0;

  for (let i = 0; i < daysInMonth; i++) {
    totalDay += dayHours[i];
    totalNight += nightHours[i];
  }

  const total = totalDay + totalNight;

  let workDaysCount = 0;
  for (let i = 1; i <= daysInMonth; i++) {
    const dayOfWeek = new Date(currentYear, currentMonth, i).getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) workDaysCount++;
  }

  const holidayCount = isHoliday.filter(Boolean).length;
  const norm = workDaysCount * 8 - holidayCount * 8;

  const overtime = total - norm;

  animateNumber(totalHoursEl, total, formatNumber, 560);
  bump(totalHoursEl);

  dayNightHoursEl.textContent = `${totalDay.toFixed(1)} / ${totalNight.toFixed(1)}`;
  bump(dayNightHoursEl);

  animateNumber(normHoursEl, norm, formatNumber, 560);
  bump(normHoursEl);

  animateNumber(overtimeEl, overtime, (v) => (v >= 0 ? "+" : "") + v.toFixed(1), 560);
  bump(overtimeEl);
}

calculateTotals();