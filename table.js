// =========================
// FILE: /table.js
// =========================
import { parseNumber, BONUS_RATE, TAX_RATE, NIGHT_EXTRA_RATE, computeSalary } from "./calc.js";
import { requireSession, signOut } from "./auth.js";
import { getMyProfile, loadTimesheet, saveTimesheet } from "./db.js";

document.body.classList.add("is-loaded");

const prefersReducedMotion =
  window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

const LEAVE_HOURS_PER_DAY = 8;

// header controls
const logoutBtn = document.getElementById("logoutBtn");
const adminLink = document.getElementById("adminLink");
const saveBtn = document.getElementById("saveBtn");
const saveStatus = document.getElementById("saveStatus");

const monthSelect = document.getElementById("monthSelect");
const yearSelect = document.getElementById("yearSelect");

function setSaveStatus(text, tone = "neutral") {
  if (!saveStatus) return;
  saveStatus.textContent = text;

  saveStatus.classList.remove(
    "text-slate-300", "bg-white/5",
    "text-emerald-200", "bg-emerald-500/10",
    "text-rose-200", "bg-rose-500/10",
    "text-sky-200", "bg-sky-500/10"
  );

  if (tone === "ok") saveStatus.classList.add("text-emerald-200", "bg-emerald-500/10");
  else if (tone === "err") saveStatus.classList.add("text-rose-200", "bg-rose-500/10");
  else if (tone === "busy") saveStatus.classList.add("text-sky-200", "bg-sky-500/10");
  else saveStatus.classList.add("text-slate-300", "bg-white/5");
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
  box.offsetWidth;
  box.classList.add("shake");
}

function isWeekendByIndex(y, m, dayIndex0) {
  const d = new Date(y, m, dayIndex0 + 1).getDay();
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

const monthNames = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const monthYearDisplay = document.getElementById("monthYearDisplay");

// DOM (money)
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

// DOM (summary)
const totalHoursEl = document.getElementById("totalHours");
const dayNightHoursEl = document.getElementById("dayNightHours");
const normEffectiveEl = document.getElementById("normEffective");
const overtimeEl = document.getElementById("overtime");

// Table DOM
const headerRow = document.getElementById("headerRow");
const dayRow = document.getElementById("dayRow");
const nightRow = document.getElementById("nightRow");

// State per month
let year = new Date().getFullYear();
let month = new Date().getMonth();
let daysInMonth = 30;

let isHoliday = [];
let dayHours = [];
let nightHours = [];
let leaveType = [];

let headerCells = [];
let dayInputs = [];
let nightInputs = [];

// profile cache
let profileRole = "user";
let profileOklad = null;

// saving
let timesheetSaveTimer = null;
let lastSavedJSON = "";
let dirty = false;

function markDirty() {
  dirty = true;
  setSaveStatus("Есть несохранённые изменения", "neutral");
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

function calendarNormHours() {
  let weekdays = 0;
  let holidayWeekdays = 0;

  for (let i = 0; i < daysInMonth; i++) {
    if (isWeekendByIndex(year, month, i)) continue;
    weekdays++;
    if (isHoliday[i]) holidayWeekdays++;
  }

  return (weekdays - holidayWeekdays) * 8;
}

function personalNormHours(monthNorm) {
  const vacDays = leaveType.filter((t) => t === "vacation").length;
  const sickDays = leaveType.filter((t) => t === "sick").length;
  const personalNorm = monthNorm - (vacDays + sickDays) * LEAVE_HOURS_PER_DAY;
  return { vacDays, sickDays, personalNorm };
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
  if (leaveType[index]) {
    setError("Уберите ОТ/Б в этом дне, затем отмечайте праздник.");
    return;
  }
  isHoliday[index] = !isHoliday[index];
  updateHolidayColumnClasses(index);
  recalcAll();
  scheduleSave();
}

function currentPayload() {
  return { v: 1, year, month, isHoliday, dayHours, nightHours, leaveType };
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
  monthYearDisplay.textContent = `${monthNames[month]} ${year}`;

  const monthNorm = calendarNormHours();
  const { vacDays, sickDays, personalNorm } = personalNormHours(monthNorm);

  const totalDay = sum(dayHours);
  const totalNight = sum(nightHours);
  const workedHours = totalDay + totalNight;

  animateNumber(totalHoursEl, workedHours, (v) => v.toFixed(1), 360);
  dayNightHoursEl.textContent = `${totalDay.toFixed(1)} / ${totalNight.toFixed(1)}`;
  bump(dayNightHoursEl);

  animateNumber(normEffectiveEl, personalNorm, (v) => v.toFixed(1), 360);
  animateNumber(overtimeEl, workedHours - personalNorm, (v) => (v >= 0 ? "+" : "") + v.toFixed(1), 360);
  leaveDaysEl.textContent = `${vacDays} / ${sickDays}`;

  const oklad = parseNumber(okladInput.value);
  if (!Number.isFinite(oklad) || oklad <= 0) {
    clearMoneyUI();
    return;
  }

  if (!(monthNorm > 0)) {
    setError("Норма месяца стала ≤ 0. Проверьте праздники.");
    clearMoneyUI();
    return;
  }

  setError(null);

  const calc = computeSalary({
    oklad,
    normHours: monthNorm,
    workedHours,
    nightHours: totalNight,
  });

  if (!calc.ok) {
    setError(calc.error);
    clearMoneyUI();
    return;
  }

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

  const nightHourNet = r.hourRate + baseHourRateGross * NIGHT_EXTRA_RATE * (1 - TAX_RATE);
  animateNumber(nightHourNetEl, nightHourNet, (v) => formatRub(v, 0), 360);

  animateNumber(baseFactGrossEl, r.baseFact, (v) => formatRub(v, 0), 360);
  animateNumber(bonusGrossEl, r.bonus, (v) => formatRub(v, 0), 360);
  animateNumber(nightExtraGrossEl, r.nightExtra, (v) => formatRub(v, 0), 360);

  animateNumber(holidayExtraGrossEl, holidayExtraGross, (v) => formatRub(v, 0), 360);

  animateNumber(grossPayEl, grossTotal, (v) => formatRub(v, 0), 360);
  animateNumber(taxPayEl, taxTotal, (v) => formatRub(v, 0), 360);

  animateNumber(netPayEl, netTotal, (v) => formatRub(v, 0), 520);
  bump(netPayEl);

  moneySummaryEl.textContent =
    `Брутто: ${formatRub(grossTotal, 0)} • Налог: ${formatRub(taxTotal, 0)} • Праздничные x2 (доплата): ${formatRub(holidayExtraGross, 0)}`;

  const endFH = Math.min(14, daysInMonth - 1);
  const fhDay = sumRange(dayHours, 0, endFH);
  const fhNight = sumRange(nightHours, 0, endFH);
  const fhTotal = fhDay + fhNight;

  const baseNetHourlyNoBonus = (oklad * (1 - TAX_RATE)) / monthNorm;
  const nightExtraNetHourly = (oklad / monthNorm) * NIGHT_EXTRA_RATE * (1 - TAX_RATE);

  const advanceApprox = baseNetHourlyNoBonus * fhTotal + nightExtraNetHourly * fhNight;
  const remainingApprox = netTotal - advanceApprox;

  advancePayEl.textContent = `~ ${formatRub(advanceApprox, 0)}`;
  remainingPayEl.textContent = `~ ${formatRub(remainingApprox, 0)}`;

  if (normHint) {
    normHint.textContent = `Норма месяца (для ставки): ${monthNorm.toFixed(0)} ч`;
  }
}

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
  td.style.fontWeight = "600";
  td.style.color = "#cbd5e1";
  return td;
}

function buildTableForMonth() {
  resetTableDom();

  daysInMonth = new Date(year, month + 1, 0).getDate();

  isHoliday = new Array(daysInMonth).fill(false);
  dayHours = new Array(daysInMonth).fill(0);
  nightHours = new Array(daysInMonth).fill(0);
  leaveType = new Array(daysInMonth).fill(null);

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
    th.title = "Тап/клик — праздник (норма месяца -8ч)";
    th.addEventListener("click", (e) => toggleHoliday(Number(e.currentTarget.dataset.dayIndex)));

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
          setError("ОТ/Б нельзя ставить на праздник. Сначала уберите отметку праздника.");
          dayInput.value = "";
          return;
        }

        setError(null);
        leaveType[i] = parsed.leave;
        dayHours[i] = 0;
        nightHours[i] = 0;

        if (nightInputs[i]) {
          nightInputs[i].value = "";
          nightInputs[i].disabled = true;
          nightInputs[i].classList.add("opacity-50", "cursor-not-allowed");
        }

        recalcAll();
        scheduleSave();
        return;
      }

      if (parsed.kind === "hours") {
        setError(null);

        if (leaveType[i]) {
          leaveType[i] = null;
          if (nightInputs[i]) {
            nightInputs[i].disabled = false;
            nightInputs[i].classList.remove("opacity-50", "cursor-not-allowed");
          }
        }

        dayHours[i] = Math.max(0, parsed.hours);
        recalcAll();
        scheduleSave();
        return;
      }

      if (!raw.trim()) {
        setError(null);
        if (leaveType[i]) {
          leaveType[i] = null;
          if (nightInputs[i]) {
            nightInputs[i].disabled = false;
            nightInputs[i].classList.remove("opacity-50", "cursor-not-allowed");
          }
        }
        dayHours[i] = 0;
        recalcAll();
        scheduleSave();
        return;
      }

      setError("Некорректное значение. Введите часы (например 11) или ОТ/Б.");
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
        scheduleSave();
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
      scheduleSave();
    });

    nightTd.appendChild(nightInput);
    nightRow.appendChild(nightTd);
    nightInputs.push(nightInput);
  }
}

function applyPayload(payload) {
  if (!payload || typeof payload !== "object") return;

  if (Array.isArray(payload.isHoliday) && payload.isHoliday.length === daysInMonth) isHoliday = payload.isHoliday;
  if (Array.isArray(payload.dayHours) && payload.dayHours.length === daysInMonth) dayHours = payload.dayHours;
  if (Array.isArray(payload.nightHours) && payload.nightHours.length === daysInMonth) nightHours = payload.nightHours;
  if (Array.isArray(payload.leaveType) && payload.leaveType.length === daysInMonth) leaveType = payload.leaveType;

  for (let i = 0; i < daysInMonth; i++) {
    updateHolidayColumnClasses(i);

    const dt = leaveType[i];
    if (dt === "vacation") dayInputs[i].value = "ОТ";
    else if (dt === "sick") dayInputs[i].value = "Б";
    else dayInputs[i].value = String(dayHours[i] ?? 0);

    if (leaveType[i]) {
      nightInputs[i].value = "";
      nightInputs[i].disabled = true;
      nightInputs[i].classList.add("opacity-50", "cursor-not-allowed");
    } else {
      nightInputs[i].disabled = false;
      nightInputs[i].classList.remove("opacity-50", "cursor-not-allowed");
      nightInputs[i].value = String(nightHours[i] ?? 0);
    }
  }
}

function setFromQueryOrNow() {
  const u = new URL(location.href);
  const qYear = Number(u.searchParams.get("year"));
  const qMonth = Number(u.searchParams.get("month"));

  if (Number.isInteger(qYear) && qYear >= 2000 && qYear <= 2100) year = qYear;
  if (Number.isInteger(qMonth) && qMonth >= 0 && qMonth <= 11) month = qMonth;

  monthSelect.value = String(month);
}

function fillYearOptions() {
  const nowY = new Date().getFullYear();
  const years = [];
  for (let y = nowY - 2; y <= nowY + 1; y++) years.push(y);

  yearSelect.innerHTML = "";
  for (const y of years) {
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

// events
logoutBtn?.addEventListener("click", async () => {
  try { await signOut(); } finally { location.href = "login.html?next=table.html"; }
});

saveBtn?.addEventListener("click", async () => {
  await doSaveTimesheet();
});

okladInput.addEventListener("input", () => {
  recalcAll();
});

monthSelect.addEventListener("change", async () => {
  month = Number(monthSelect.value);
  updateUrlForMonth();
  buildTableForMonth();
  await loadCurrentMonthFromDb();
  recalcAll();
});

yearSelect.addEventListener("change", async () => {
  year = Number(yearSelect.value);
  updateUrlForMonth();
  buildTableForMonth();
  await loadCurrentMonthFromDb();
  recalcAll();
});

// boot
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

    if (profileRole === "admin") adminLink?.classList.remove("hidden");

    if (profileOklad != null && String(okladInput.value ?? "").trim() === "") {
      okladInput.value = String(profileOklad);
    }
  } catch {
    // ignore
  }

  await loadCurrentMonthFromDb();
  recalcAll();
})();