import { parseNumber, BONUS_RATE, TAX_RATE, NIGHT_EXTRA_RATE } from "./calc.js";

document.body.classList.add("is-loaded");

const prefersReducedMotion =
  window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

const HOLIDAY_MULTIPLIER = 2;
const LEAVE_HOURS_PER_DAY = 8;

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

function formatRub(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: digits,
  }).format(n);
}

function setError(msg) {
  const box = document.getElementById("errorBox");
  if (!box) return;

  if (!msg) {
    box.classList.add("hidden");
    box.textContent = "";
    box.classList.remove("shake");
    return;
  }

  box.classList.remove("hidden");
  box.textContent = msg;
  box.classList.remove("shake");
  // eslint-disable-next-line no-unused-expressions
  box.offsetWidth;
  box.classList.add("shake");
}

function isWeekendByIndex(year, month, dayIndex0) {
  const d = new Date(year, month, dayIndex0 + 1).getDay();
  return d === 0 || d === 6;
}

function normalizeLeaveToken(raw) {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!s) return null;
  const mapped = s.replaceAll("O", "О").replaceAll("T", "Т").replaceAll("B", "Б").replaceAll("L", "Л");
  if (mapped === "ОТ") return "vacation";
  if (mapped === "Б" || mapped === "БЛ") return "sick";
  return null;
}

function parseHoursOrLeave(raw) {
  const leave = normalizeLeaveToken(raw);
  if (leave) return { kind: "leave", leave };
  const n = parseNumber(raw);
  if (!Number.isFinite(n)) return { kind: "invalid" };
  return { kind: "hours", hours: n };
}

const today = new Date();
const year = today.getFullYear();
const month = today.getMonth();

const monthNames = [
  "Январь","Февраль","Март","Апрель","Май","Июнь",
  "Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь",
];

document.getElementById("monthYearDisplay").textContent = `${monthNames[month]} ${year}`;

const daysInMonth = new Date(year, month + 1, 0).getDate();

const okladInput = document.getElementById("okladInput");
const normHint = document.getElementById("normHint");

const netPayEl = document.getElementById("netPay");
const moneySummaryEl = document.getElementById("moneySummary");

const hourRateNetEl = document.getElementById("hourRateNet");
const nightHourNetEl = document.getElementById("nightHourNet");
const holidayExtraGrossEl = document.getElementById("holidayExtraGross");

const baseFactGrossEl = document.getElementById("baseFactGross");
const bonusGrossEl = document.getElementById("bonusGross");
const nightExtraGrossEl = document.getElementById("nightExtraGross");

const grossPayEl = document.getElementById("grossPay");
const taxPayEl = document.getElementById("taxPay");

const advancePayEl = document.getElementById("advancePay");
const remainingPayEl = document.getElementById("remainingPay");
const leaveDaysEl = document.getElementById("leaveDays");

const totalHoursEl = document.getElementById("totalHours");
const dayNightHoursEl = document.getElementById("dayNightHours");
const normEffectiveEl = document.getElementById("normEffective");
const overtimeEl = document.getElementById("overtime");

const headerRow = document.getElementById("headerRow");
const dayRow = document.getElementById("dayRow");
const nightRow = document.getElementById("nightRow");

const headerCells = [];
const dayInputs = [];
const nightInputs = [];

let isHoliday = new Array(daysInMonth).fill(false);
let dayHours = new Array(daysInMonth).fill(0);
let nightHours = new Array(daysInMonth).fill(0);
let leaveType = new Array(daysInMonth).fill(null); // "vacation" | "sick" | null

function updateHolidayColumnClasses(index) {
  const col = [
    headerCells[index],
    dayInputs[index]?.closest("td"),
    nightInputs[index]?.closest("td"),
  ].filter(Boolean);

  for (const el of col) {
    if (isHoliday[index]) el.classList.add("holiday-col");
    else el.classList.remove("holiday-col");
  }
}

function toggleHoliday(index) {
  isHoliday[index] = !isHoliday[index];
  updateHolidayColumnClasses(index);
  recalcAll();
}

const emptyTh = document.createElement("th");
emptyTh.textContent = "";
headerRow.appendChild(emptyTh);

for (let i = 1; i <= daysInMonth; i++) {
  const th = document.createElement("th");
  th.textContent = i;
  th.dataset.dayIndex = String(i - 1);

  const weekend = isWeekendByIndex(year, month, i - 1);
  if (weekend) th.classList.add("weekend-col");

  th.style.cursor = "pointer";
  th.title = "Тап/клик — праздничный день (x2)";

  th.addEventListener("click", (e) => {
    const idx = Number(e.currentTarget.dataset.dayIndex);
    toggleHoliday(idx);
  });

  headerRow.appendChild(th);
  headerCells.push(th);
}

function makeLabelCell(text) {
  const td = document.createElement("td");
  td.textContent = text;
  td.style.fontWeight = "600";
  td.style.color = "#cbd5e1";
  return td;
}

dayRow.appendChild(makeLabelCell("День"));
nightRow.appendChild(makeLabelCell("Ночь"));

function setLeave(index, type) {
  leaveType[index] = type;
  dayHours[index] = 0;
  nightHours[index] = 0;

  if (nightInputs[index]) {
    nightInputs[index].value = "";
    nightInputs[index].disabled = true;
    nightInputs[index].classList.add("opacity-50", "cursor-not-allowed");
  }
}

function clearLeave(index) {
  leaveType[index] = null;
  if (nightInputs[index]) {
    nightInputs[index].disabled = false;
    nightInputs[index].classList.remove("opacity-50", "cursor-not-allowed");
  }
}

for (let i = 0; i < daysInMonth; i++) {
  const dayTd = document.createElement("td");
  const weekend = isWeekendByIndex(year, month, i);
  if (weekend) dayTd.classList.add("weekend-col");

  const dayInput = document.createElement("input");
  dayInput.type = "text";
  dayInput.inputMode = "decimal";
  dayInput.placeholder = "0";
  dayInput.classList.add("input-hour", "input-glass");
  dayInput.autocapitalize = "characters";
  dayInput.spellcheck = false;

  dayInput.addEventListener("input", () => {
    const raw = dayInput.value;
    const parsed = parseHoursOrLeave(raw);

    if (parsed.kind === "leave") {
      if (weekend) {
        setError("ОТ/Б нельзя ставить на выходные (сб/вс).");
        dayInput.value = "";
        return;
      }
      if (isHoliday[i]) {
        setError("ОТ/Б нельзя ставить на праздничный день (сначала уберите праздник).");
        dayInput.value = "";
        return;
      }

      setError(null);
      setLeave(i, parsed.leave);
      recalcAll();
      return;
    }

    if (parsed.kind === "hours") {
      setError(null);
      if (leaveType[i]) clearLeave(i);
      dayHours[i] = Math.max(0, parsed.hours);
      recalcAll();
      return;
    }

    if (!raw.trim()) {
      setError(null);
      if (leaveType[i]) clearLeave(i);
      dayHours[i] = 0;
      recalcAll();
      return;
    }

    setError("Некорректное значение. Введите часы (например 11) или ОТ/Б.");
  });

  dayTd.appendChild(dayInput);
  dayRow.appendChild(dayTd);
  dayInputs.push(dayInput);

  const nightTd = document.createElement("td");
  if (weekend) nightTd.classList.add("weekend-col");

  const nightInput = document.createElement("input");
  nightInput.type = "text";
  nightInput.inputMode = "decimal";
  nightInput.placeholder = "0";
  nightInput.classList.add("input-hour", "input-glass");
  nightInput.spellcheck = false;

  nightInput.addEventListener("input", () => {
    if (leaveType[i]) return;

    const raw = nightInput.value;
    if (!raw.trim()) {
      setError(null);
      nightHours[i] = 0;
      recalcAll();
      return;
    }

    const n = parseNumber(raw);
    if (!Number.isFinite(n)) {
      setError("Ночные: введите число (например 7) или оставьте пусто.");
      return;
    }

    setError(null);
    nightHours[i] = Math.max(0, n);
    recalcAll();
  });

  nightTd.appendChild(nightInput);
  nightRow.appendChild(nightTd);
  nightInputs.push(nightInput);

  if (isHoliday[i]) updateHolidayColumnClasses(i);
}

function sum(arr) {
  return arr.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
}

function sumRange(arr, startIdx, endIdxInclusive) {
  let s = 0;
  for (let i = startIdx; i <= endIdxInclusive; i++) {
    s += Number.isFinite(arr[i]) ? arr[i] : 0;
  }
  return s;
}

function baseNormHoursFromCalendar() {
  let workdays = 0;
  for (let i = 0; i < daysInMonth; i++) {
    if (!isWeekendByIndex(year, month, i)) workdays++;
  }
  return workdays * 8;
}

function effectiveNormHours(baseNorm) {
  const vacDays = leaveType.filter((t) => t === "vacation").length;
  const sickDays = leaveType.filter((t) => t === "sick").length;
  return {
    vacDays,
    sickDays,
    norm: baseNorm - (vacDays + sickDays) * LEAVE_HOURS_PER_DAY,
  };
}

function holidayWorkedTotals() {
  let hDay = 0;
  let hNight = 0;

  for (let i = 0; i < daysInMonth; i++) {
    if (!isHoliday[i]) continue;
    if (leaveType[i]) continue;

    hDay += dayHours[i] || 0;
    hNight += nightHours[i] || 0;
  }

  return { hDay, hNight };
}

function holidayWorkedTotalsFirstHalf() {
  const end = Math.min(14, daysInMonth - 1);
  let hDay = 0;
  let hNight = 0;

  for (let i = 0; i <= end; i++) {
    if (!isHoliday[i]) continue;
    if (leaveType[i]) continue;

    hDay += dayHours[i] || 0;
    hNight += nightHours[i] || 0;
  }

  return { hDay, hNight };
}

function clearMoneyUI() {
  netPayEl.textContent = "—";
  moneySummaryEl.textContent = "";
  hourRateNetEl.textContent = "—";
  nightHourNetEl.textContent = "—";
  holidayExtraGrossEl.textContent = "—";
  baseFactGrossEl.textContent = "—";
  bonusGrossEl.textContent = "—";
  nightExtraGrossEl.textContent = "—";
  grossPayEl.textContent = "—";
  taxPayEl.textContent = "—";
  advancePayEl.textContent = "—";
  remainingPayEl.textContent = "—";
}

function recalcAll() {
  const baseNorm = baseNormHoursFromCalendar();
  const { vacDays, sickDays, norm } = effectiveNormHours(baseNorm);

  normHint.textContent = `Норма месяца: ${baseNorm} ч. С учётом ОТ/Б: ${norm} ч.`;

  const totalDay = sum(dayHours);
  const totalNight = sum(nightHours);
  const total = totalDay + totalNight;

  animateNumber(totalHoursEl, total, (v) => v.toFixed(1), 360);
  dayNightHoursEl.textContent = `${totalDay.toFixed(1)} / ${totalNight.toFixed(1)}`;
  bump(dayNightHoursEl);

  animateNumber(normEffectiveEl, norm, (v) => v.toFixed(1), 360);
  animateNumber(overtimeEl, total - norm, (v) => (v >= 0 ? "+" : "") + v.toFixed(1), 360);
  leaveDaysEl.textContent = `${vacDays} / ${sickDays}`;

  const oklad = parseNumber(okladInput.value);
  if (!Number.isFinite(oklad) || oklad <= 0) {
    clearMoneyUI();
    return;
  }

  if (!(norm > 0)) {
    setError("Норма стала ≤ 0 (слишком много ОТ/Б).");
    clearMoneyUI();
    return;
  }

  setError(null);

  const baseHourRateGross = oklad / norm;
  const bonusPerHourGross = (oklad * BONUS_RATE) / norm;

  const baseFactGross = baseHourRateGross * total;
  const bonusGross = bonusPerHourGross * total;
  const nightExtraGross = baseHourRateGross * NIGHT_EXTRA_RATE * totalNight;

  // ✅ Праздник x2 = добавить ещё 1× стоимости этих часов (не меняя норму)
  const { hDay, hNight } = holidayWorkedTotals();
  const holidayTotal = hDay + hNight;
  const holidayExtraGross =
    (baseHourRateGross + bonusPerHourGross) * holidayTotal +
    baseHourRateGross * NIGHT_EXTRA_RATE * hNight;

  const gross = baseFactGross + bonusGross + nightExtraGross + holidayExtraGross;
  const tax = gross * TAX_RATE;
  const net = gross - tax;

  // Ставки (нетто)
  const hourRateNet = (baseHourRateGross + bonusPerHourGross) * (1 - TAX_RATE);
  const nightHourNet = hourRateNet + baseHourRateGross * NIGHT_EXTRA_RATE * (1 - TAX_RATE);

  // Аванс (~): 1–15, без премии, но с ночными и праздничными
  const endFH = Math.min(14, daysInMonth - 1);
  const fhDay = sumRange(dayHours, 0, endFH);
  const fhNight = sumRange(nightHours, 0, endFH);
  const fhTotal = fhDay + fhNight;

  const baseNetHourlyNoBonus = baseHourRateGross * (1 - TAX_RATE);
  const nightExtraNetHourly = baseHourRateGross * NIGHT_EXTRA_RATE * (1 - TAX_RATE);

  let advanceNet = baseNetHourlyNoBonus * fhTotal + nightExtraNetHourly * fhNight;

  const fhHoliday = holidayWorkedTotalsFirstHalf();
  const fhHolidayTotal = fhHoliday.hDay + fhHoliday.hNight;

  // extra 1x for holiday hours in first half (no bonus)
  advanceNet += baseNetHourlyNoBonus * fhHolidayTotal + nightExtraNetHourly * fhHoliday.hNight;

  const remainingNet = net - advanceNet;

  // UI
  animateNumber(netPayEl, net, (v) => formatRub(v, 0), 520);
  bump(netPayEl);

  moneySummaryEl.textContent =
    `Брутто: ${formatRub(gross, 0)} • Налог: ${formatRub(tax, 0)} • Праздничные x2 (доплата): ${formatRub(holidayExtraGross, 0)}`;

  animateNumber(hourRateNetEl, hourRateNet, (v) => formatRub(v, 0), 360);
  animateNumber(nightHourNetEl, nightHourNet, (v) => formatRub(v, 0), 360);

  animateNumber(holidayExtraGrossEl, holidayExtraGross, (v) => formatRub(v, 0), 360);
  animateNumber(baseFactGrossEl, baseFactGross, (v) => formatRub(v, 0), 360);
  animateNumber(bonusGrossEl, bonusGross, (v) => formatRub(v, 0), 360);
  animateNumber(nightExtraGrossEl, nightExtraGross, (v) => formatRub(v, 0), 360);
  animateNumber(grossPayEl, gross, (v) => formatRub(v, 0), 360);
  animateNumber(taxPayEl, tax, (v) => formatRub(v, 0), 360);

  advancePayEl.textContent = `~ ${formatRub(advanceNet, 0)}`;
  remainingPayEl.textContent = `~ ${formatRub(remainingNet, 0)}`;
}

okladInput.addEventListener("input", recalcAll);
recalcAll();