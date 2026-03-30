// =========================
// FILE: /table.js
// =========================
import { parseNumber, BONUS_RATE, TAX_RATE, NIGHT_EXTRA_RATE, computeSalary } from "./calc.js";
import { requireSession, signOut } from "./auth.js";
import { getMyProfile, loadTimesheet, saveTimesheet } from "./db.js";

document.body.classList.add("is-loaded");

const prefersReducedMotion =
  window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

const DEFAULT_DAY_HOURS = 8;
const FEMALE_DAY_HOURS = 7.2;

let BASE_DAY_HOURS = DEFAULT_DAY_HOURS;
let LEAVE_HOURS_PER_DAY = DEFAULT_DAY_HOURS;

const MAX_HOURS_PER_DAY = 24;
const SHORT_DAY_REDUCTION_HOURS = 1;

let focusDayIndex = null;

// ✅ Mobile toolbar: index of the currently "selected" day
let mobileSelectedIdx = 0;

const logoutBtn = document.getElementById("logoutBtn");
const adminLink = document.getElementById("adminLink");
const saveBtn = document.getElementById("saveBtn");
const saveStatus = document.getElementById("saveStatus");

const monthSelect = document.getElementById("monthSelect");
const yearSelect = document.getElementById("yearSelect");

const monthNames = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const DOW_SHORT = ["Вс","Пн","Вт","Ср","Чт","Пт","Сб"];
const monthYearDisplay = document.getElementById("monthYearDisplay");

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
const normMonthEl = document.getElementById("normMonth");
const normEffectiveEl = document.getElementById("normEffective");
const overtimeEl = document.getElementById("overtime");

const headerRow = document.getElementById("headerRow");
const dayRow = document.getElementById("dayRow");
const nightRow = document.getElementById("nightRow");
const tableScrollable = document.getElementById("tableScrollable");

// Mobile toolbar elements
const mPrevDayBtn = document.getElementById("mPrevDay");
const mNextDayBtn = document.getElementById("mNextDay");
const mTodayBtn = document.getElementById("mToday");
const mHolidayBtn = document.getElementById("mHolidayBtn");
const mShortBtn = document.getElementById("mShortBtn");
const mDayLabel = document.getElementById("mDayLabel");

function ensureShortDayStyles() {
  if (document.getElementById("shortDayStyles")) return;
  const st = document.createElement("style");
  st.id = "shortDayStyles";
  st.textContent = `
    .short-col { background-color: rgba(16, 185, 129, 0.18) !important; }
    .timesheet-table th.short-col { background-color: rgba(16, 185, 129, 0.22) !important; color: rgba(167, 243, 208, 0.95) !important; }
    .focus-col { box-shadow: inset 0 0 0 2px rgba(56, 189, 248, 0.6) !important; }
    .timesheet-table th.focus-col { color: rgba(224, 231, 255, 0.95) !important; }
  `;
  document.head.appendChild(st);
}
ensureShortDayStyles();

function setSaveStatus(text, tone = "neutral") {
  if (!saveStatus) return;
  saveStatus.textContent = text;
  saveStatus.classList.remove(
    "text-slate-300","bg-white/5",
    "text-emerald-200","bg-emerald-500/10",
    "text-rose-200","bg-rose-500/10",
    "text-sky-200","bg-sky-500/10"
  );
  if (tone === "ok") saveStatus.classList.add("text-emerald-200","bg-emerald-500/10");
  else if (tone === "err") saveStatus.classList.add("text-rose-200","bg-rose-500/10");
  else if (tone === "busy") saveStatus.classList.add("text-sky-200","bg-sky-500/10");
  else saveStatus.classList.add("text-slate-300","bg-white/5");
}

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

function bump(el) {
  if (prefersReducedMotion || !el) return;
  el.classList.remove("pop");
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
    el.textContent = formatter(from + (to - from) * k);
    if (t < 1) requestAnimationFrame(tick);
    else { el.textContent = formatter(to); el.dataset.value = String(to); }
  }
  requestAnimationFrame(tick);
}

function formatRub(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: digits }).format(n);
}

function setError(msg) {
  const box = document.getElementById("errorBox");
  if (!box) return;
  if (!msg) { box.classList.add("hidden"); box.textContent = ""; box.classList.remove("shake"); return; }
  box.classList.remove("hidden");
  box.textContent = msg;
  box.classList.remove("shake");
  box.offsetWidth;
  box.classList.add("shake");
}

function isWeekendByIndex(y, m, dayIndex0) {
  const d = new Date(y, m, dayIndex0 + 1).getDay();
  return d === 0 || d === 6;
}

function sanitizeDayCellValue(raw) {
  let s = String(raw ?? "").toUpperCase();

  // Latin -> Cyrillic for common codes
  s = s
    .replaceAll("O", "О")
    .replaceAll("T", "Т")
    .replaceAll("B", "Б")
    .replaceAll("D", "Д")
    .replaceAll("Z", "З")
    .replaceAll("U", "У")
    .replaceAll("Y", "У");

  s = s.replace(/\s+/g, "");

  // If user types letters, keep only known code letters.
  const letters = s.replace(/[^ОТБДЗУЛ]/g, "");
  if (letters) {
    if (letters.includes("Б")) return "Б";

    if (letters.startsWith("О")) {
      const second = letters[1] || "";
      if (second === "Т") return "ОТ";
      if (second === "Д") return "ОД";
      if (second === "З") return "ОЗ";
      return "О"; // allow partial; blur will convert to "ОТ"
    }

    if (letters.startsWith("У")) {
      const second = letters[1] || "";
      if (second === "Д") return "УД";
      return "У";
    }

    return "";
  }

  // Numeric branch
  let num = s.replace(/[^0-9.,]/g, "");
  if (!num) return "";
  if (num.includes(".") && num.includes(",")) num = num.replace(/,/g, ".");
  const sepIdx = num.search(/[.,]/);
  if (sepIdx !== -1) {
    const before = num.slice(0, sepIdx);
    const sep = num[sepIdx];
    const after = num.slice(sepIdx + 1).replace(/[.,]/g, "");
    num = before + sep + after;
  }
  return num;
}

function sanitizeNumericValue(raw) {
  let s = String(raw ?? "").trim().replace(/\s+/g, "").replace(/[^0-9.,]/g, "");
  if (!s) return "";
  if (s.includes(".") && s.includes(",")) s = s.replace(/,/g, ".");
  const sepIdx = s.search(/[.,]/);
  if (sepIdx !== -1) {
    const before = s.slice(0, sepIdx);
    const sep = s[sepIdx];
    const after = s.slice(sepIdx + 1).replace(/[.,]/g, "");
    s = before + sep + after;
  }
  return s;
}

function normalizeLeaveToken(raw) {
  const s0 = String(raw ?? "").trim().toUpperCase();
  if (!s0) return null;

  // Latin -> Cyrillic for common codes
  const s = s0
    .replaceAll("O", "О")
    .replaceAll("T", "Т")
    .replaceAll("B", "Б")
    .replaceAll("D", "Д")
    .replaceAll("Z", "З")
    .replaceAll("U", "У")
    .replaceAll("Y", "У")
    .replaceAll("L", "Л");

  // Canonical codes (we store types in payload)
  if (s === "О" || s === "ОТ") return "vac_paid";
  if (s === "ОД") return "vac_unpaid";
  if (s === "ОЗ") return "vac_unpaid_required";

  if (s === "Б" || s === "БЛ") return "sick";

  if (s === "У") return "edu_paid";
  if (s === "УД") return "edu_unpaid";

  return null;
}

function parseHoursOrLeave(raw) {
  const leave = normalizeLeaveToken(raw);
  if (leave) return { kind: "leave", leave };
  const n = parseNumber(raw);
  if (!Number.isFinite(n)) return { kind: "invalid" };
  return { kind: "hours", hours: n };
}

function normalizeLeaveTypeLegacy(lt) {
  if (!lt) return null;
  if (lt === "vacation") return "vac_paid";
  if (lt === "sick") return "sick";
  return String(lt);
}

function leaveTypeToCode(lt, raw = "") {
  const t = normalizeLeaveTypeLegacy(lt);
  if (!t) return "";
  if (t === "vac_paid") {
    const r = String(raw ?? "").trim().toUpperCase();
    return r === "О" ? "О" : "ОТ";
  }
  if (t === "vac_unpaid") return "ОД";
  if (t === "vac_unpaid_required") return "ОЗ";
  if (t === "edu_paid") return "У";
  if (t === "edu_unpaid") return "УД";
  if (t === "sick") return "Б";
  return "";
}

function sanitizeLeaveDisplayValue(raw, leaveType) {
  const code = leaveTypeToCode(leaveType, raw);
  return code || String(raw ?? "").trim().toUpperCase();
}

function sanitizeHourNumber(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, n);
}

function formatHourForInput(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || Math.abs(x) < 1e-9) return "";
  return String(x);
}

function clampDayTotalOrRevert({ index, nextDay, nextNight, onRevert }) {
  const d = sanitizeHourNumber(nextDay);
  const n = sanitizeHourNumber(nextNight);
  if (d > MAX_HOURS_PER_DAY || n > MAX_HOURS_PER_DAY || d + n > MAX_HOURS_PER_DAY) {
    setError(`В сутки нельзя больше ${MAX_HOURS_PER_DAY} ч. Проверьте день ${index + 1}.`);
    onRevert?.();
    return false;
  }
  return true;
}

let daysInMonth = 30;
let dayInputs = [];
let nightInputs = [];
let headerCells = [];

function isFocusableInput(el) { return Boolean(el) && !el.disabled; }
function focusAndSelect(el) { if (!el) return; el.focus(); if (typeof el.select === "function") el.select(); }
function getGridInput(rowType, idx) { return rowType === "day" ? dayInputs[idx] : nightInputs[idx]; }

function focusCell(rowType, idx) {
  const primary = getGridInput(rowType, idx);
  if (isFocusableInput(primary)) { focusAndSelect(primary); return true; }
  const fallback = getGridInput("day", idx);
  if (isFocusableInput(fallback)) { focusAndSelect(fallback); return true; }
  return false;
}

function focusHorizontal(rowType, startIdx, step) {
  let i = startIdx;
  while (i >= 0 && i < daysInMonth) {
    if (focusCell(rowType, i)) return;
    i += step;
  }
}

function attachArrowNavigation(inputEl, rowType, index) {
  inputEl.dataset.row = rowType;
  inputEl.dataset.idx = String(index);
  inputEl.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    if (!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(k)) return;
    if ((k === "ArrowLeft" || k === "ArrowRight") && typeof inputEl.selectionStart === "number") {
      const start = inputEl.selectionStart ?? 0;
      const end = inputEl.selectionEnd ?? 0;
      const len = String(inputEl.value ?? "").length;
      if (k === "ArrowLeft" && !(start === 0 && end === 0)) return;
      if (k === "ArrowRight" && !(start === len && end === len)) return;
    }
    e.preventDefault();
    const idx = Number(inputEl.dataset.idx);
    const row = inputEl.dataset.row;
    if (k === "ArrowLeft") focusHorizontal(row, idx - 1, -1);
    else if (k === "ArrowRight") focusHorizontal(row, idx + 1, +1);
    else focusCell(row === "day" ? "night" : "day", idx);
  });
}

let year = new Date().getFullYear();
let month = new Date().getMonth();

let isHoliday = [];
let isShortDay = [];
let dayHours = [];
let nightHours = [];
let leaveType = [];

let profileRole = "user";
let profileOklad = null;

let timesheetSaveTimer = null;
let lastSavedJSON = "";
let dirty = false;

function markDirty() {
  dirty = true;
  setSaveStatus("Есть несохранённые изменения", "neutral");
}

function sumArr(arr) { return arr.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0); }
function sumRange(arr, startIdx, endIdxInclusive) {
  let s = 0;
  for (let i = startIdx; i <= endIdxInclusive; i++) s += Number.isFinite(arr[i]) ? arr[i] : 0;
  return s;
}

function calendarNormHours() {
  let weekdays = 0, holidayWeekdays = 0, shortWeekdays = 0;
  for (let i = 0; i < daysInMonth; i++) {
    if (isWeekendByIndex(year, month, i)) continue;
    weekdays++;
    if (isHoliday[i]) holidayWeekdays++;
    else if (isShortDay[i]) shortWeekdays++;
  }
  return weekdays * BASE_DAY_HOURS - holidayWeekdays * BASE_DAY_HOURS - shortWeekdays * SHORT_DAY_REDUCTION_HOURS;
}

function personalNormHours(monthNorm) {
  let otTotal = 0;
  let sickTotal = 0;
  let unpaidTotal = 0; // ОД + ОЗ
  let eduTotal = 0; // У + УД

  let effectiveLeaveDays = 0;

  for (let i = 0; i < daysInMonth; i++) {
    const lt = normalizeLeaveTypeLegacy(leaveType[i]);
    if (!lt) continue;

    if (lt === "vac_paid") otTotal++;
    else if (lt === "sick") sickTotal++;
    else if (lt === "vac_unpaid" || lt === "vac_unpaid_required") unpaidTotal++;
    else if (lt === "edu_paid" || lt === "edu_unpaid") eduTotal++;

    if (!isHoliday[i]) effectiveLeaveDays++;
  }

  const personalNorm = monthNorm - effectiveLeaveDays * LEAVE_HOURS_PER_DAY;
  return { otTotal, sickTotal, unpaidTotal, eduTotal, personalNorm };
}

function holidayWorkedTotals() {
  let hDay = 0, hNight = 0;
  for (let i = 0; i < daysInMonth; i++) {
    if (!isHoliday[i] || leaveType[i]) continue;
    hDay += dayHours[i] || 0;
    hNight += nightHours[i] || 0;
  }
  return { hDay, hNight };
}

// =========================
// ✅ Mobile toolbar logic
// =========================

function isMobileNow() {
  return window.matchMedia?.("(max-width: 767px)")?.matches ?? (window.innerWidth < 768);
}

/**
 * Scroll the table container so the column at `idx` is roughly centred.
 * Works by reading the actual th element's offsetLeft.
 */
function scrollTableToColumn(idx) {
  if (!tableScrollable) return;
  const th = headerCells[idx];
  if (!th) return;

  const containerWidth = tableScrollable.clientWidth;
  const thLeft = th.offsetLeft;
  const thWidth = th.offsetWidth;

  // Label sticky column width (approx)
  const labelWidth = 46;

  // Target: centre the th in the visible scroll area (excluding sticky label)
  const targetScrollLeft = thLeft - labelWidth - (containerWidth - labelWidth) / 2 + thWidth / 2;

  tableScrollable.scrollTo({
    left: Math.max(0, targetScrollLeft),
    behavior: prefersReducedMotion ? "auto" : "smooth",
  });
}

/**
 * Update the day label and highlight/unhighlight buttons in the mobile toolbar.
 */
function updateMobileToolbar() {
  if (!isMobileNow()) return;

  const idx = mobileSelectedIdx;
  if (!Number.isInteger(idx) || idx < 0 || idx >= daysInMonth) return;

  const d = new Date(year, month, idx + 1);
  if (mDayLabel) mDayLabel.textContent = `${idx + 1} · ${DOW_SHORT[d.getDay()]}`;

  if (mHolidayBtn) mHolidayBtn.classList.toggle("is-active", Boolean(isHoliday[idx]));
  if (mShortBtn) mShortBtn.classList.toggle("is-active", Boolean(isShortDay[idx]));
}

/**
 * Select a day in the mobile toolbar: update label, highlight column, scroll to it.
 */
function setMobileDay(idx) {
  if (idx < 0) idx = 0;
  if (idx >= daysInMonth) idx = daysInMonth - 1;
  mobileSelectedIdx = idx;

  // Highlight the column
  focusDayColumn(idx);

  // Scroll table to show the column
  scrollTableToColumn(idx);

  // Update toolbar label + active buttons
  updateMobileToolbar();
}

// Toolbar events
mPrevDayBtn?.addEventListener("click", () => setMobileDay(mobileSelectedIdx - 1));
mNextDayBtn?.addEventListener("click", () => setMobileDay(mobileSelectedIdx + 1));
mTodayBtn?.addEventListener("click", () => {
  const now = new Date();
  if (now.getFullYear() === year && now.getMonth() === month) {
    setMobileDay(now.getDate() - 1);
  }
});
mHolidayBtn?.addEventListener("click", () => {
  const idx = mobileSelectedIdx;
  if (!Number.isInteger(idx)) return;
  isShortDay[idx] = false;
  isHoliday[idx] = !isHoliday[idx];
  updateDayMarkClasses(idx);
  recalcAll();
  scheduleSave();
  updateMobileToolbar();
});
mShortBtn?.addEventListener("click", () => {
  const idx = mobileSelectedIdx;
  if (!Number.isInteger(idx)) return;
  if (isHoliday[idx]) isHoliday[idx] = false;
  isShortDay[idx] = !isShortDay[idx];
  updateDayMarkClasses(idx);
  recalcAll();
  scheduleSave();
  updateMobileToolbar();
});

function updateDayMarkClasses(index) {
  const col = [
    headerCells[index],
    dayInputs[index]?.closest("td"),
    nightInputs[index]?.closest("td"),
  ].filter(Boolean);

  for (const el of col) {
    el.classList.remove("holiday-col", "short-col");
    if (isHoliday[index]) el.classList.add("holiday-col");
    else if (isShortDay[index]) el.classList.add("short-col");
  }
}

function currentPayload() {
  return { v: 4, year, month, isHoliday, isShortDay, dayHours, nightHours, leaveType };
}

async function doSaveTimesheet() {
  setSaveStatus("Сохраняю…", "busy");
  try {
    const payload = currentPayload();
    const json = JSON.stringify(payload);
    await saveTimesheet(year, month, payload);
    lastSavedJSON = json;
    dirty = false;
    setSaveStatus(
      `Сохранено: ${new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`,
      "ok"
    );
  } catch (e) {
    setSaveStatus("Ошибка сохранения", "err");
    setError(e?.message || "Не удалось сохранить табель.");
  }
}

function scheduleSave() {
  markDirty();
  if (timesheetSaveTimer) clearTimeout(timesheetSaveTimer);

  timesheetSaveTimer = setTimeout(async () => {
    const json = JSON.stringify(currentPayload());
    if (json === lastSavedJSON) {
      dirty = false;
      setSaveStatus("Сохранено", "ok");
      return;
    }
    await doSaveTimesheet();
  }, 900);
}

function clearMoneyUI() {
  if (netPayEl) netPayEl.textContent = "—";
  if (moneySummaryEl) moneySummaryEl.textContent = "";
  if (hourRateNetEl) hourRateNetEl.textContent = "—";
  if (nightHourNetEl) nightHourNetEl.textContent = "—";
  if (holidayExtraGrossEl) holidayExtraGrossEl.textContent = "—";

  if (baseFactGrossEl) baseFactGrossEl.textContent = "—";
  if (bonusGrossEl) bonusGrossEl.textContent = "—";
  if (nightExtraGrossEl) nightExtraGrossEl.textContent = "—";

  if (grossPayEl) grossPayEl.textContent = "—";
  if (taxPayEl) taxPayEl.textContent = "—";
  if (advancePayEl) advancePayEl.textContent = "—";
  if (remainingPayEl) remainingPayEl.textContent = "—";
}

function recalcAll() {
  if (monthYearDisplay) monthYearDisplay.textContent = `${monthNames[month]} ${year}`;

  const monthNorm = calendarNormHours();
  const { otTotal, sickTotal, unpaidTotal, eduTotal, personalNorm } = personalNormHours(monthNorm);

  const totalDay = sumArr(dayHours);
  const totalNight = sumArr(nightHours);
  const workedHours = totalDay + totalNight;

  animateNumber(totalHoursEl, workedHours, (v) => v.toFixed(1), 360);
  if (dayNightHoursEl) { dayNightHoursEl.textContent = `${totalDay.toFixed(1)} / ${totalNight.toFixed(1)}`; bump(dayNightHoursEl); }
  animateNumber(normMonthEl, monthNorm, (v) => v.toFixed(1), 360);
  animateNumber(normEffectiveEl, personalNorm, (v) => v.toFixed(1), 360);
  animateNumber(overtimeEl, workedHours - personalNorm, (v) => (v >= 0 ? "+" : "") + v.toFixed(1), 360);
  if (leaveDaysEl) leaveDaysEl.textContent = `ОТ:${otTotal} • Б:${sickTotal} • ОД/ОЗ:${unpaidTotal} • У/УД:${eduTotal}`;

  const oklad = parseNumber(okladInput.value);
  if (!Number.isFinite(oklad) || oklad <= 0) {
    clearMoneyUI();
    if (normHint) normHint.textContent = monthNorm > 0 ? `Норма месяца: ${monthNorm.toFixed(1)} ч` : "";
    return;
  }

  if (!(monthNorm > 0)) {
    setError("Норма месяца стала ≤ 0. Проверьте праздники/сокращённые дни.");
    clearMoneyUI();
    return;
  }

  setError(null);

  const calc = computeSalary({ oklad, normHours: monthNorm, workedHours, nightHours: totalNight });
  if (!calc.ok) { setError(calc.error); clearMoneyUI(); return; }

  const r = calc.result;
  const baseHourRateGross = oklad / monthNorm;
  const bonusPerHourGross = (oklad * BONUS_RATE) / monthNorm;
  const { hDay, hNight } = holidayWorkedTotals();
  const holidayTotal = hDay + hNight;

  const holidayExtraGross =
    (baseHourRateGross + bonusPerHourGross) * holidayTotal +
    baseHourRateGross * NIGHT_EXTRA_RATE * hNight;

  const holidayTax = holidayExtraGross * TAX_RATE;
  const holidayNet = holidayExtraGross - holidayTax;
  const grossTotal = r.gross + holidayExtraGross;
  const taxTotal = r.tax + holidayTax;
  const netTotal = r.net + holidayNet;

  animateNumber(hourRateNetEl, r.hourRate, (v) => formatRub(v, 0), 360);
  animateNumber(nightHourNetEl, r.hourRate + baseHourRateGross * NIGHT_EXTRA_RATE * (1 - TAX_RATE), (v) => formatRub(v, 0), 360);
  animateNumber(baseFactGrossEl, r.baseFact, (v) => formatRub(v, 0), 360);
  animateNumber(bonusGrossEl, r.bonus, (v) => formatRub(v, 0), 360);
  animateNumber(nightExtraGrossEl, r.nightExtra, (v) => formatRub(v, 0), 360);
  animateNumber(holidayExtraGrossEl, holidayExtraGross, (v) => formatRub(v, 0), 360);
  animateNumber(grossPayEl, grossTotal, (v) => formatRub(v, 0), 360);
  animateNumber(taxPayEl, taxTotal, (v) => formatRub(v, 0), 360);
  animateNumber(netPayEl, netTotal, (v) => formatRub(v, 0), 520);
  bump(netPayEl);

  if (moneySummaryEl) moneySummaryEl.textContent =
    `Брутто: ${formatRub(grossTotal, 0)} • Налог: ${formatRub(taxTotal, 0)} • Праздничные x2 (доплата): ${formatRub(holidayExtraGross, 0)}`;

  const endFH = Math.min(14, daysInMonth - 1);
  const fhDay = sumRange(dayHours, 0, endFH);
  const fhNight = sumRange(nightHours, 0, endFH);
  const fhTotal = fhDay + fhNight;
  const baseNetHourlyNoBonus = (oklad * (1 - TAX_RATE)) / monthNorm;
  const nightExtraNetHourly = (oklad / monthNorm) * NIGHT_EXTRA_RATE * (1 - TAX_RATE);
  const advanceApprox = baseNetHourlyNoBonus * fhTotal + nightExtraNetHourly * fhNight;
  if (advancePayEl) advancePayEl.textContent = `~ ${formatRub(advanceApprox, 0)}`;
  if (remainingPayEl) remainingPayEl.textContent = `~ ${formatRub(netTotal - advanceApprox, 0)}`;
}

// =========================
// Table DOM
// =========================

function resetTableDom() {
  headerRow.innerHTML = "";
  dayRow.innerHTML = "";
  nightRow.innerHTML = "";
  headerCells = [];
  dayInputs = [];
  nightInputs = [];
}

function makeLabelCell(text) {
  const td = document.createElement("td");
  td.textContent = text;
  td.classList.add("label-cell");
  return td;
}

function attachPrevValueTracking(inputEl) {
  inputEl.addEventListener("focus", () => { inputEl.dataset.prev = inputEl.value ?? ""; });
}
function revertToPrev(inputEl) { inputEl.value = inputEl.dataset.prev ?? ""; }

function lockNightCell(i) {
  const el = nightInputs?.[i];
  if (!el) return;
  el.value = "";
  el.disabled = true;
  el.classList.add("opacity-50","cursor-not-allowed");
}

function unlockNightCell(i) {
  const el = nightInputs?.[i];
  if (!el) return;
  el.disabled = false;
  el.classList.remove("opacity-50","cursor-not-allowed");
}

function clearFocusColumn() {
  for (let i = 0; i < headerCells.length; i++) {
    headerCells[i]?.classList.remove("focus-col");
    dayInputs[i]?.closest("td")?.classList.remove("focus-col");
    nightInputs[i]?.closest("td")?.classList.remove("focus-col");
  }
}

function focusDayColumn(dayIdx0) {
  if (!Number.isInteger(dayIdx0) || dayIdx0 < 0 || dayIdx0 >= daysInMonth) return;
  clearFocusColumn();
  headerCells[dayIdx0]?.classList.add("focus-col");
  dayInputs[dayIdx0]?.closest("td")?.classList.add("focus-col");
  nightInputs[dayIdx0]?.closest("td")?.classList.add("focus-col");
}

function buildTableForMonth() {
  resetTableDom();

  daysInMonth = new Date(year, month + 1, 0).getDate();
  isHoliday = new Array(daysInMonth).fill(false);
  isShortDay = new Array(daysInMonth).fill(false);
  dayHours = new Array(daysInMonth).fill(0);
  nightHours = new Array(daysInMonth).fill(0);
  leaveType = new Array(daysInMonth).fill(null);

  const emptyTh = document.createElement("th");
  emptyTh.textContent = "";
  emptyTh.classList.add("label-cell");
  headerRow.appendChild(emptyTh);

  for (let i = 1; i <= daysInMonth; i++) {
    const th = document.createElement("th");
    th.textContent = i;
    th.dataset.dayIndex = String(i - 1);

    const weekend = isWeekendByIndex(year, month, i - 1);
    if (weekend) th.classList.add("weekend-col");

    th.style.cursor = "pointer";
    th.title = "Клик — праздник. Даблклик — сокращённый день.";

    let clickTimer = null;
    th.addEventListener("click", (e) => {
      const idx = Number(e.currentTarget.dataset.dayIndex);
      if (clickTimer) return;
      clickTimer = setTimeout(() => {
        clickTimer = null;
        isShortDay[idx] = false;
        isHoliday[idx] = !isHoliday[idx];
        updateDayMarkClasses(idx);
        recalcAll();
        scheduleSave();
        updateMobileToolbar();
      }, 240);
    });

    th.addEventListener("dblclick", (e) => {
      const idx = Number(e.currentTarget.dataset.dayIndex);
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
      }
      if (isHoliday[idx]) isHoliday[idx] = false;
      isShortDay[idx] = !isShortDay[idx];
      updateDayMarkClasses(idx);
      recalcAll();
      scheduleSave();
      updateMobileToolbar();
    });

    headerRow.appendChild(th);
    headerCells.push(th);
  }

  dayRow.appendChild(makeLabelCell("День"));
  nightRow.appendChild(makeLabelCell("Ночь"));

  for (let i = 0; i < daysInMonth; i++) {
    const weekend = isWeekendByIndex(year, month, i);

    const dayTd = document.createElement("td");
    if (weekend) dayTd.classList.add("weekend-col");

    const dayInput = document.createElement("input");
    dayInput.type = "text";
    dayInput.inputMode = "text";
    dayInput.placeholder = "";
    dayInput.classList.add("input-hour", "input-glass");
    dayInput.autocapitalize = "characters";
    dayInput.spellcheck = false;

    attachPrevValueTracking(dayInput);
    attachArrowNavigation(dayInput, "day", i);

    dayInput.addEventListener("focus", () => {
      if (isMobileNow()) {
        mobileSelectedIdx = i;
        updateMobileToolbar();
        focusDayColumn(i);
        scrollTableToColumn(i);
      }
    });

    dayInput.addEventListener("blur", () => {
      const s = String(dayInput.value ?? "").trim();
      if (s === "0" || s === "0.0" || s === "0,0") {
        dayInput.value = "";
        dayHours[i] = 0;
        scheduleSave();
        recalcAll();
      }
      const v = String(dayInput.value ?? "").trim().toUpperCase();
      if (v === "О") {
        dayInput.value = "ОТ";
        dayInput.dataset.prev = "ОТ";
      }
    });

    dayInput.addEventListener("input", () => {
      const sanitized = sanitizeDayCellValue(dayInput.value);
      if (sanitized !== dayInput.value) dayInput.value = sanitized;

      const raw = dayInput.value;

      if (!raw.trim()) {
        setError(null);
        if (leaveType[i]) {
          leaveType[i] = null;
          unlockNightCell(i);
        }
        dayHours[i] = 0;
        dayInput.dataset.prev = "";
        recalcAll();
        scheduleSave();
        return;
      }

      const parsed = parseHoursOrLeave(raw);

      if (parsed.kind === "leave") {
        if (weekend) {
          setError("Коды отсутствия нельзя ставить на выходные (сб/вс).");
          revertToPrev(dayInput);
          return;
        }

        setError(null);
        leaveType[i] = parsed.leave;
        dayInput.value = sanitizeLeaveDisplayValue(raw, parsed.leave);

        dayHours[i] = 0;
        nightHours[i] = 0;

        lockNightCell(i);

        dayInput.dataset.prev = dayInput.value;
        recalcAll();
        scheduleSave();
        return;
      }

      if (parsed.kind === "hours") {
        setError(null);

        if (leaveType[i]) {
          leaveType[i] = null;
          unlockNightCell(i);
        }

        const nextDay = sanitizeHourNumber(parsed.hours);
        const nextNight = sanitizeHourNumber(nightHours[i] || 0);

        const ok = clampDayTotalOrRevert({
          index: i,
          nextDay,
          nextNight,
          onRevert: () => revertToPrev(dayInput),
        });
        if (!ok) return;

        dayHours[i] = nextDay;
        dayInput.dataset.prev = dayInput.value;

        recalcAll();
        scheduleSave();
        return;
      }

      setError("Некорректное значение. Допустимы только числа или коды: ОТ, ОД, ОЗ, У, УД, Б.");
    });

    dayTd.appendChild(dayInput);
    dayRow.appendChild(dayTd);
    dayInputs.push(dayInput);

    const nightTd = document.createElement("td");
    nightTd.classList.add("night-cell");
    if (weekend) nightTd.classList.add("weekend-col");

    const nightInput = document.createElement("input");
    nightInput.type = "text";
    nightInput.inputMode = "decimal";
    nightInput.placeholder = "";
    nightInput.classList.add("input-hour", "input-glass");
    nightInput.spellcheck = false;

    attachPrevValueTracking(nightInput);
    attachArrowNavigation(nightInput, "night", i);

    nightInput.addEventListener("focus", () => {
      if (isMobileNow()) {
        mobileSelectedIdx = i;
        updateMobileToolbar();
        focusDayColumn(i);
        scrollTableToColumn(i);
      }
    });

    nightInput.addEventListener("blur", () => {
      const s = String(nightInput.value ?? "").trim();
      if (s === "0" || s === "0.0" || s === "0,0") { nightInput.value = ""; nightHours[i] = 0; scheduleSave(); recalcAll(); }
    });

    nightInput.addEventListener("input", () => {
      if (leaveType[i]) return;
      const sanitized = sanitizeNumericValue(nightInput.value);
      if (sanitized !== nightInput.value) nightInput.value = sanitized;
      const raw = nightInput.value;

      if (!raw.trim()) { setError(null); nightHours[i] = 0; nightInput.dataset.prev = ""; recalcAll(); scheduleSave(); return; }

      const n = parseNumber(raw);
      if (!Number.isFinite(n)) { setError("Ночные: введите число или оставьте пусто."); return; }

      const nextNight = sanitizeHourNumber(n);
      const nextDay = sanitizeHourNumber(dayHours[i] || 0);
      const ok = clampDayTotalOrRevert({ index: i, nextDay, nextNight, onRevert: () => revertToPrev(nightInput) });
      if (!ok) return;

      setError(null); nightHours[i] = nextNight; nightInput.dataset.prev = nightInput.value;
      recalcAll(); scheduleSave();
    });

    nightTd.appendChild(nightInput);
    nightRow.appendChild(nightTd);
    nightInputs.push(nightInput);
  }
}

function applyPayload(payload) {
  if (!payload || typeof payload !== "object") return;
  if (Array.isArray(payload.isHoliday) && payload.isHoliday.length === daysInMonth) isHoliday = payload.isHoliday;
  if (Array.isArray(payload.isShortDay) && payload.isShortDay.length === daysInMonth) isShortDay = payload.isShortDay;
  if (Array.isArray(payload.dayHours) && payload.dayHours.length === daysInMonth) dayHours = payload.dayHours;
  if (Array.isArray(payload.nightHours) && payload.nightHours.length === daysInMonth) nightHours = payload.nightHours;
  if (Array.isArray(payload.leaveType) && payload.leaveType.length === daysInMonth) leaveType = payload.leaveType.map((x) => normalizeLeaveTypeLegacy(x));

  for (let i = 0; i < daysInMonth; i++) {
    updateDayMarkClasses(i);
    const dt = normalizeLeaveTypeLegacy(leaveType[i]);
    if (dt) dayInputs[i].value = leaveTypeToCode(dt, "ОТ");
    else dayInputs[i].value = formatHourForInput(dayHours[i]);

    if (leaveType[i]) lockNightCell(i);
    else { unlockNightCell(i); nightInputs[i].value = formatHourForInput(nightHours[i]); }

    dayInputs[i].dataset.prev = dayInputs[i].value ?? "";
    nightInputs[i].dataset.prev = nightInputs[i].value ?? "";
  }

  updateMobileToolbar();
}

function setFromQueryOrNow() {
  const u = new URL(location.href);
  const hasYear = u.searchParams.has("year");
  const hasMonth = u.searchParams.has("month");
  const qYear = Number(u.searchParams.get("year"));
  const qMonth = Number(u.searchParams.get("month"));
  const qDay = Number(u.searchParams.get("day"));

  if (!hasYear && !hasMonth) {
    const now = new Date(); year = now.getFullYear(); month = now.getMonth();
  } else {
    if (Number.isInteger(qYear) && qYear >= 2000 && qYear <= 2100) year = qYear;
    if (Number.isInteger(qMonth) && qMonth >= 0 && qMonth <= 11) month = qMonth;
  }

  focusDayIndex = (Number.isInteger(qDay) && qDay >= 1 && qDay <= 31) ? qDay - 1 : null;
  if (monthSelect) monthSelect.value = String(month);
}

function fillYearOptions() {
  const nowY = new Date().getFullYear();
  yearSelect.innerHTML = "";
  for (let y = nowY - 2; y <= nowY + 1; y++) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    yearSelect.appendChild(opt);
  }
  yearSelect.value = String(year);
}

function updateUrlForMonth() {
  const u = new URL(location.href);
  u.searchParams.set("year", String(year));
  u.searchParams.set("month", String(month));
  u.searchParams.delete("day");
  focusDayIndex = null;
  history.replaceState(null, "", u.toString());
}

async function loadCurrentMonthFromDb() {
  setSaveStatus("Загружаю…", "busy");
  try {
    const payload = await loadTimesheet(year, month);
    if (payload) {
      applyPayload(payload);
      lastSavedJSON = JSON.stringify(currentPayload());
      dirty = false;
      setSaveStatus("Сохранено", "ok");
    } else {
      lastSavedJSON = JSON.stringify(currentPayload());
      dirty = false;
      setSaveStatus("Новый табель", "neutral");
    }
  } catch (e) {
    setSaveStatus("Ошибка загрузки", "err");
    setError(e?.message || "Не удалось загрузить табель.");
  }
}

// =========================
// Events
// =========================

logoutBtn?.addEventListener("click", async () => {
  try { await signOut(); } finally { location.href = "login.html?next=table.html"; }
});

saveBtn?.addEventListener("click", async () => {
  await doSaveTimesheet();
});

okladInput?.addEventListener("input", () => { recalcAll(); });

monthSelect.addEventListener("change", async () => {
  month = Number(monthSelect.value);
  updateUrlForMonth();
  buildTableForMonth();
  await loadCurrentMonthFromDb();
  recalcAll();
  if (isMobileNow()) setMobileDay(mobileSelectedIdx);
});

yearSelect.addEventListener("change", async () => {
  year = Number(yearSelect.value);
  updateUrlForMonth();
  buildTableForMonth();
  await loadCurrentMonthFromDb();
  recalcAll();
  if (isMobileNow()) setMobileDay(mobileSelectedIdx);
});

// =========================
// Boot
// =========================

(async () => {
  try {
    await requireSession();
  } catch {
    location.href = "login.html?next=table.html";
    return;
  }

  setFromQueryOrNow();
  fillYearOptions();
  updateUrlForMonth();

  buildTableForMonth();

  try {
    const profile = await getMyProfile();
    profileRole = profile?.role ?? "user";
    profileOklad = profile?.oklad ?? null;

    if (profile?.gender === "female") BASE_DAY_HOURS = FEMALE_DAY_HOURS;
    else BASE_DAY_HOURS = DEFAULT_DAY_HOURS;

    LEAVE_HOURS_PER_DAY = BASE_DAY_HOURS;

    if (profileRole === "admin") adminLink?.classList.remove("hidden");

    if (profileOklad != null && String(okladInput?.value ?? "").trim() === "") {
      okladInput.value = String(profileOklad);
    }
  } catch {
    // ignore
  }

  await loadCurrentMonthFromDb();
  recalcAll();

  // Mobile: init toolbar to "today" if in this month, else day 1
  if (isMobileNow()) {
    const now = new Date();
    if (now.getFullYear() === year && now.getMonth() === month) setMobileDay(now.getDate() - 1);
    else setMobileDay(0);
  }

  if (Number.isInteger(focusDayIndex) && focusDayIndex >= 0 && focusDayIndex < daysInMonth) {
    focusDayColumn(focusDayIndex);
    scrollTableToColumn(focusDayIndex);
    if (isMobileNow()) setMobileDay(focusDayIndex);
  }

  window.addEventListener("resize", () => {
    if (isMobileNow()) updateMobileToolbar();
  });
})();