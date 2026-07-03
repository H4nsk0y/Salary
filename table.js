
import { parseNumber, BONUS_RATE, TAX_RATE, NIGHT_EXTRA_RATE, computeSalary } from "./calc.js";
import { requireSession, signOut } from "./auth.js";
import { getMyProfile, getMyManagedDepartment, listMyTimesheetsBefore, loadTimesheet, saveTimesheet } from "./db.js";
import { startPresenceHeartbeat } from "./presence.js";
import {
  buildProfileCompletionUrl,
  getMissingRequiredProfileFields,
  getMissingRequiredProfileLabels,
} from "./profileCompletion.js";

import {
  createMoneyAccessGuard,
  EYE_ICON,
  EYE_OFF_ICON,
  isMoneyProtectionEnabled,
  setRevealButtonState,
} from "./moneyPrivacy.js";

document.body.classList.add("is-loaded");

const prefersReducedMotion =
  window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

const DEFAULT_DAY_HOURS = 8;
const FEMALE_DAY_HOURS = 7.2;
const DEFAULT_WEEKLY_HOURS = 40;
const REDUCED_WEEKLY_HOURS = 35;
const CHATEAU_ALVISA_BRANCH = "chateau_alvisa";
const HAZARD_POSITION_RATE = 0.04;

let BASE_DAY_HOURS = DEFAULT_DAY_HOURS;
let LEAVE_HOURS_PER_DAY = DEFAULT_DAY_HOURS;

const MAX_HOURS_PER_DAY = 24;
const ADVANCE_PAYMENT_DAY = 25;
const REMAINING_PAYMENT_DAY = 10;
const SHORT_DAY_REDUCTION_HOURS = 1;
const NOT_EMPLOYED_LEAVE_TYPE = "not_employed";
const DISMISSED_LEAVE_TYPE = "dismissed";
const VACATION_PAY_MONTHS_REQUIRED = 12;
const VACATION_PAY_AVERAGE_CALENDAR_DAYS = 29.3;

let focusDayIndex = null;
let mobileSelectedIdx = 0;
let dismissedBeforeMonth = false;

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
const okladPeekBtnInitial = document.getElementById("okladInputPeekBtn");
const useProfileOkladBtn = document.getElementById("useProfileOkladBtn");
const monthStatusBadge = document.getElementById("monthStatusBadge");

const payResultsWrap = document.getElementById("payResultsWrap");
const payPeekBtnInitial = document.getElementById("payPeekBtn");
const payPeekText = document.getElementById("payPeekText");
const payPeekIcon = document.getElementById("payPeekIcon");
const payWarningsBox = document.getElementById("payWarningsBox");
const paymentCountdownCard = document.getElementById("paymentCountdownCard");
const paymentCountdownValue = document.getElementById("paymentCountdownValue");
const paymentCountdownHint = document.getElementById("paymentCountdownHint");
const actualConfirmHint = document.getElementById("actualConfirmHint");
const paidLeaveHint = document.getElementById("paidLeaveHint");

const actualNetInput = document.getElementById("actualNetInput");
const actualAdvanceInput = document.getElementById("actualAdvanceInput");
const actualRemainingInput = document.getElementById("actualRemainingInput");
const actualPaidLeaveNetInput = document.getElementById("actualPaidLeaveNetInput");
const actualPaidLeaveTaxInput = document.getElementById("actualPaidLeaveTaxInput");

const fillActualFromCalcBtn = document.getElementById("fillActualFromCalcBtn");
const confirmActualBtn = document.getElementById("confirmActualBtn");
const clearActualBtn = document.getElementById("clearActualBtn");

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
const vacationPayEstimateEl = document.getElementById("vacationPayEstimate");
const vacationPayEstimateHint = document.getElementById("vacationPayEstimateHint");

const totalHoursEl = document.getElementById("totalHours");
const dayNightHoursEl = document.getElementById("dayNightHours");
const normMonthEl = document.getElementById("normMonth");
const normEffectiveEl = document.getElementById("normEffective");
const overtimeEl = document.getElementById("overtime");

const normFirstHalfEl = document.getElementById("normFirstHalf");
const workedFirstHalfEl = document.getElementById("workedFirstHalf");

const headerRow = document.getElementById("headerRow");
const dayRow = document.getElementById("dayRow");
const nightRow = document.getElementById("nightRow");
const tableScrollable = document.getElementById("tableScrollable");

const mPrevDayBtn = document.getElementById("mPrevDay");
const mNextDayBtn = document.getElementById("mNextDay");
const mTodayBtn = document.getElementById("mToday");
const mHolidayBtn = document.getElementById("mHolidayBtn");
const mTransferredBtn = document.getElementById("mTransferredBtn");
const mShortBtn = document.getElementById("mShortBtn");
const mDayLabel = document.getElementById("mDayLabel");

const okladPanel = document.getElementById("okladPanel");
const helpPanel = document.getElementById("helpPanel");

let profileCompletionGateEl = null;

function applyAutoCollapsedPanels(profile) {
  if (profile?.auto_collapse_table_panels !== true) return;

  okladPanel?.removeAttribute("open");
  helpPanel?.removeAttribute("open");
}

function renderProfileCompletionGate(profile) {
  if (profileCompletionGateEl) return;

  const missingKeys = getMissingRequiredProfileFields(profile);
  const missingLabels = getMissingRequiredProfileLabels(profile);
  const nextUrl = `${location.pathname}${location.search}${location.hash}`;
  const profileUrl = buildProfileCompletionUrl(nextUrl, missingKeys);

  document.body.classList.add("overflow-hidden");
  setSaveStatus("Заполните профиль", "err");
  setError(`Табель временно недоступен. Заполните профиль: ${missingLabels.join(", ")}.`);

  const gate = document.createElement("div");
  gate.id = "profileCompletionGate";
  gate.className = "fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/88 px-4 backdrop-blur-sm";

  gate.innerHTML = `
    <div class="w-full max-w-2xl rounded-3xl border border-amber-400/20 bg-slate-900/95 p-6 md:p-8 text-slate-100 shadow-2xl">
      <div class="inline-flex items-center rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-200 ring-1 ring-amber-400/20">
        Табель временно заблокирован
      </div>

      <h2 class="mt-4 text-2xl md:text-3xl font-bold tracking-tight">
        Сначала заполните профиль
      </h2>

      <p class="mt-3 text-sm md:text-base text-slate-300">
        Чтобы табель считал часы, норму и зарплату корректно, нужно заполнить обязательные поля профиля.
      </p>

      <div class="mt-5 flex flex-wrap gap-2">
        ${missingLabels.map((label) => `
          <span class="rounded-full bg-rose-500/12 px-3 py-1.5 text-sm font-medium text-rose-200 ring-1 ring-rose-400/20">
            ${label}
          </span>
        `).join("")}
      </div>

      <div class="mt-6 rounded-2xl bg-white/5 p-4 text-sm text-slate-300 ring-1 ring-white/10">
        После сохранения профиля табель станет доступен автоматически.
      </div>

      <div class="mt-6 flex flex-col gap-3 sm:flex-row">
        <a
          href="${profileUrl}"
          class="inline-flex items-center justify-center rounded-2xl bg-indigo-500 px-5 py-3 text-sm font-semibold text-white transition-all hover:bg-indigo-400"
        >
          Заполнить профиль
        </a>

        <a
          href="index.html"
          class="inline-flex items-center justify-center rounded-2xl bg-white/5 px-5 py-3 text-sm font-semibold text-slate-200 ring-1 ring-white/10 transition-all hover:bg-white/10"
        >
          Перейти в калькулятор
        </a>
      </div>
    </div>
  `;

  document.body.appendChild(gate);
  profileCompletionGateEl = gate;
}

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

function formatDateTime(value) {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getHazardRateByPosition(position) {
  const p = String(position ?? "").trim().toLowerCase();
  if (p === "loader" || p === "грузчик") return HAZARD_POSITION_RATE;
  return 0;
}

function normalizeWeeklyHours(value) {
  const n = Number(value);
  if (n === REDUCED_WEEKLY_HOURS) return REDUCED_WEEKLY_HOURS;
  if (n === DEFAULT_WEEKLY_HOURS) return DEFAULT_WEEKLY_HOURS;
  return null;
}

function getWeeklyHoursByProfile(profile) {
  return normalizeWeeklyHours(profile?.weekly_hours) ?? DEFAULT_WEEKLY_HOURS;
}

function getBaseDayHoursByProfile(profile) {
  if (getWeeklyHoursByProfile(profile) === REDUCED_WEEKLY_HOURS) {
    return REDUCED_WEEKLY_HOURS / 5;
  }

  return profile?.gender === "female" && profile?.branch === CHATEAU_ALVISA_BRANCH
    ? FEMALE_DAY_HOURS
    : DEFAULT_DAY_HOURS;
}

function normalizeNormSnapshot(raw) {
  if (!raw || typeof raw !== "object") return null;
  const baseDayHours = Number(raw.baseDayHours);
  if (!(Number.isFinite(baseDayHours) && baseDayHours > 0)) return null;

  return {
    weeklyHours: normalizeWeeklyHours(raw.weeklyHours),
    baseDayHours,
    gender: raw.gender ?? null,
    branch: raw.branch ?? null,
  };
}

function currentNormProfile() {
  return {
    gender: profileGender,
    branch: profileBranch,
    weekly_hours: profileWeeklyHours,
  };
}

function createNormSnapshot(profile = currentNormProfile(), baseDayHours = null) {
  const existing = normalizeNormSnapshot(currentLoadedPayload?.normSnapshot);
  const resolvedBaseDayHours = Number(baseDayHours ?? getBaseDayHoursByProfile(profile));
  if (existing && Math.abs(existing.baseDayHours - resolvedBaseDayHours) < 0.001) {
    return existing;
  }

  const weeklyHours = getWeeklyHoursByProfile(profile);
  return {
    weeklyHours,
    baseDayHours: Number(resolvedBaseDayHours.toFixed(2)),
    gender: profile?.gender ?? null,
    branch: profile?.branch ?? null,
  };
}

function applyNormContextFromPayload(payload) {
  if (normalizeWeeklyHours(profileWeeklyHours) !== null) {
    BASE_DAY_HOURS = getBaseDayHoursByProfile(currentNormProfile());
    LEAVE_HOURS_PER_DAY = BASE_DAY_HOURS;
    return;
  }

  const snapshot = normalizeNormSnapshot(payload?.normSnapshot);
  BASE_DAY_HOURS = snapshot?.baseDayHours ?? getBaseDayHoursByProfile(currentNormProfile());
  LEAVE_HOURS_PER_DAY = BASE_DAY_HOURS;
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

function sanitizeDayCellValue(raw) {
  let s = String(raw ?? "").toUpperCase();
  s = s.replaceAll("O","О").replaceAll("T","Т").replaceAll("B","Б")
       .replaceAll("D","Д").replaceAll("Z","З").replaceAll("U","У").replaceAll("Y","У")
       .replaceAll("N","Н").replaceAll("V","В");
  s = s.replace(/\s+/g, "");
  const letters = s.replace(/[^ОТБДЗУЛНВ]/g, "");
  if (letters) {
    if (letters.includes("Б")) return "Б";
    if (letters.startsWith("Н")) {
      return "НТ";
    }
    if (letters.startsWith("О")) {
      const second = letters[1] || "";
      if (second === "Т") return "ОТ";
      if (second === "Д") return "ОД";
      if (second === "З") return "ОЗ";
      return "О";
    }
    if (letters.startsWith("У")) {
      const second = letters[1] || "";
      if (second === "В") return "УВ";
      if (second === "Д") return "УД";
      return "У";
    }
    return "";
  }
  let num = s.replace(/[^0-9.,]/g, "");
  if (!num) return "";
  if (num.includes(".") && num.includes(",")) num = num.replace(/,/g, ".");
  const sepIdx = num.search(/[.,]/);
  if (sepIdx !== -1) {
    num = num.slice(0, sepIdx) + num[sepIdx] + num.slice(sepIdx + 1).replace(/[.,]/g, "");
  }
  return num;
}

function sanitizeNumericValue(raw) {
  let s = String(raw ?? "").trim().replace(/\s+/g, "").replace(/[^0-9.,]/g, "");
  if (!s) return "";
  if (s.includes(".") && s.includes(",")) s = s.replace(/,/g, ".");
  const sepIdx = s.search(/[.,]/);
  if (sepIdx !== -1) {
    s = s.slice(0, sepIdx) + s[sepIdx] + s.slice(sepIdx + 1).replace(/[.,]/g, "");
  }
  return s;
}

function normalizeLeaveToken(raw) {
  const s0 = String(raw ?? "").trim().toUpperCase();
  if (!s0) return null;
  const s = s0.replaceAll("O","О").replaceAll("T","Т").replaceAll("B","Б")
               .replaceAll("D","Д").replaceAll("Z","З").replaceAll("U","У")
               .replaceAll("Y","У").replaceAll("L","Л").replaceAll("N","Н").replaceAll("V","В");
  if (s === "О" || s === "ОТ") return "vac_paid";
  if (s === "ОД") return "vac_unpaid";
  if (s === "ОЗ") return "vac_unpaid_required";
  if (s === "Б" || s === "БЛ") return "sick";
  if (s === "У") return "edu_paid";
  if (s === "УД") return "edu_unpaid";
  if (s === "НТ") return NOT_EMPLOYED_LEAVE_TYPE;
  if (s === "УВ") return DISMISSED_LEAVE_TYPE;
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
  if (lt === NOT_EMPLOYED_LEAVE_TYPE) return NOT_EMPLOYED_LEAVE_TYPE;
  if (lt === DISMISSED_LEAVE_TYPE) return DISMISSED_LEAVE_TYPE;
  if (String(lt).trim().toUpperCase() === "НТ") return NOT_EMPLOYED_LEAVE_TYPE;
  if (String(lt).trim().toUpperCase() === "УВ") return DISMISSED_LEAVE_TYPE;
  return String(lt);
}

function hasExtraLeavePaymentCode() {
  for (let i = 0; i < leaveType.length; i++) {
    const t = normalizeLeaveTypeLegacy(leaveType[i]);
    if (t === "vac_paid" || t === "edu_paid" || t === "sick") return true;
  }
  return false;
}

function readLeavePayoutState() {
  const raw = String(leavePayoutInput?.value ?? "").trim();
  if (!raw) {
    return { raw: "", hasValue: false, amount: 0 };
  }

  const amount = parseNumber(raw);
  return {
    raw,
    hasValue: true,
    amount: Number.isFinite(amount) ? Math.max(0, amount) : NaN,
  };
}

function syncLeavePayoutInputState() {
  if (!leavePayoutInput) return;

  const hasCode = hasExtraLeavePaymentCode();
  const current = readLeavePayoutState();

  leavePayoutInput.disabled = !hasCode;
  leavePayoutInput.classList.toggle("opacity-50", !hasCode);
  leavePayoutInput.classList.toggle("cursor-not-allowed", !hasCode);

  if (!hasCode) {
    leavePayoutInput.setAttribute("aria-disabled", "true");
    leavePayoutInput.placeholder = "Сначала поставьте ОТ, У или Б";
  } else {
    leavePayoutInput.removeAttribute("aria-disabled");
    leavePayoutInput.placeholder = "Напр. 12450";
  }

  if (!leavePayoutHint) return;

  if (!hasCode && !current.hasValue) {
    leavePayoutHint.textContent =
      "Поле станет доступно, когда в табеле появится хотя бы один код ОТ, У или Б.";
    return;
  }

  if (!hasCode && current.hasValue) {
    leavePayoutHint.textContent =
      "Сумма указана, но в табеле нет кодов ОТ, У или Б. Добавьте код или очистите сумму.";
    return;
  }

  leavePayoutHint.textContent =
    "Сюда можно внести фактически полученную сумму за отпуск, учебный отпуск или больничный.";
}

function validateLeavePayoutInput() {
  const state = readLeavePayoutState();

  if (!state.hasValue) return true;
  if (!Number.isFinite(state.amount)) {
    setError("Сумма отпускных / учебного отпуска / больничного должна быть числом.");
    return false;
  }
  if (state.amount <= 0) return true;

  if (!hasExtraLeavePaymentCode()) {
    setError("Указаны отпускные / учебный отпуск / больничный, но в табеле нет кодов ОТ, У или Б.");
    return false;
  }

  return true;
}

function leaveTypeToCode(lt, raw = "") {
  const t = normalizeLeaveTypeLegacy(lt);
  if (!t) return "";
  if (t === "vac_paid") return String(raw ?? "").trim().toUpperCase() === "О" ? "О" : "ОТ";
  if (t === "vac_unpaid") return "ОД";
  if (t === "vac_unpaid_required") return "ОЗ";
  if (t === "edu_paid") return "У";
  if (t === "edu_unpaid") return "УД";
  if (t === "sick") return "Б";
  if (t === NOT_EMPLOYED_LEAVE_TYPE) return "НТ";
  if (t === DISMISSED_LEAVE_TYPE) return "УВ";
  return "";
}

function sanitizeLeaveDisplayValue(raw, leaveType) {
  return leaveTypeToCode(leaveType, raw) || String(raw ?? "").trim().toUpperCase();
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

function formatMoneyForInput(value) {
  if (value == null) return "";
  if (typeof value === "string" && value.trim() === "") return "";

  const n = Number(value);
  if (!Number.isFinite(n)) return "";

  return String(Number(n.toFixed(2))).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function normalizeMoneyNumber(value) {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;

  const n = Number(value);
  if (!Number.isFinite(n)) return null;

  return Number(n.toFixed(2));
}

function normalizeEnteredMoneyNumber(value) {
  const n = normalizeMoneyNumber(value);
  if (n == null) return null;
  if (n <= 0) return null;
  return n;
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
let isTransferredOff = [];
let isShortDay = [];
let dayHours = [];
let nightHours = [];
let leaveType = [];

let profileRole = "user";
let profileOklad = null;
let profilePosition = "";
let profileGender = null;
let profileBranch = null;
let profileWeeklyHours = null;
let profileEmploymentDate = null;
let ensureTableMoneyAccess = async () => true;
let okladVisible = true;
let payVisible = true;
let okladPeekBtn = null;
let payPeekBtn = null;
let moneyProfile = null;

let currentLoadedPayload = null;
let currentMoneySnapshot = null;
let currentPaySummary = createEmptyPaySummary();
let suppressActualInputSync = false;
let personalSharedMarksChanged = false;
let paymentCountdownTimer = null;
let paymentCountdownRunId = 0;
const paymentMarksCache = new Map();
let vacationPayEstimateRunId = 0;
const vacationPayHistoryCache = new Map();

function replaceElementWithClone(el) {
  if (!el) return null;
  const clone = el.cloneNode(true);
  el.replaceWith(clone);
  return clone;
}

function createEmptyActualSummary() {
  return {
    net: null,
    advance: null,
    remaining: null,
    paidLeaveNet: null,
    paidLeaveTax: null,
    confirmedAt: null,
    confirmedCalculatedSignature: null,
  };
}

function createEmptyPaySummary() {
  return {
    calculated: null,
    actual: createEmptyActualSummary(),
    status: "draft",
  };
}

function cloneActualSummary(actual) {
  const src = actual && typeof actual === "object" ? actual : createEmptyActualSummary();
  return {
    net: normalizeMoneyNumber(src.net),
    advance: normalizeMoneyNumber(src.advance),
    remaining: normalizeMoneyNumber(src.remaining),
    paidLeaveNet: normalizeMoneyNumber(src.paidLeaveNet),
    paidLeaveTax: normalizeMoneyNumber(src.paidLeaveTax),
    confirmedAt: src.confirmedAt ? String(src.confirmedAt) : null,
    confirmedCalculatedSignature: src.confirmedCalculatedSignature ? String(src.confirmedCalculatedSignature) : null,
  };
}

function cloneCalculatedSummary(calculated) {
  if (!calculated || typeof calculated !== "object") return null;
  return {
    net: normalizeMoneyNumber(calculated.net),
    tax: normalizeMoneyNumber(calculated.tax),
    gross: normalizeMoneyNumber(calculated.gross),
    advance: normalizeMoneyNumber(calculated.advance),
    remaining: normalizeMoneyNumber(calculated.remaining),
    okladSnapshot: normalizeMoneyNumber(calculated.okladSnapshot),
    effectiveOkladSnapshot: normalizeMoneyNumber(calculated.effectiveOkladSnapshot),
    hazardRate: Number.isFinite(Number(calculated.hazardRate)) ? Number(Number(calculated.hazardRate).toFixed(4)) : 0,
    monthNorm: Number.isFinite(Number(calculated.monthNorm)) ? Number(Number(calculated.monthNorm).toFixed(2)) : null,
    personalNorm: Number.isFinite(Number(calculated.personalNorm)) ? Number(Number(calculated.personalNorm).toFixed(2)) : null,
    workedHours: Number.isFinite(Number(calculated.workedHours)) ? Number(Number(calculated.workedHours).toFixed(2)) : null,
    workedDayHours: Number.isFinite(Number(calculated.workedDayHours)) ? Number(Number(calculated.workedDayHours).toFixed(2)) : null,
    workedNightHours: Number.isFinite(Number(calculated.workedNightHours)) ? Number(Number(calculated.workedNightHours).toFixed(2)) : null,
    hourRateNet: normalizeMoneyNumber(calculated.hourRateNet),
    nightHourNet: normalizeMoneyNumber(calculated.nightHourNet),
    baseFactGross: normalizeMoneyNumber(calculated.baseFactGross),
    bonusGross: normalizeMoneyNumber(calculated.bonusGross),
    nightExtraGross: normalizeMoneyNumber(calculated.nightExtraGross),
    holidayExtraGross: normalizeMoneyNumber(calculated.holidayExtraGross),
  };
}

function normalizeMoneySnapshot(raw) {
  if (!raw || typeof raw !== "object") return null;

  const okladSnapshot = Number(raw.okladSnapshot);
  if (!(Number.isFinite(okladSnapshot) && okladSnapshot > 0)) return null;

  const hazardRateSnapshot = Number.isFinite(Number(raw.hazardRateSnapshot))
    ? Number(Number(raw.hazardRateSnapshot).toFixed(4))
    : 0;

  const effectiveRaw = Number(raw.effectiveOkladSnapshot);
  const effectiveOkladSnapshot =
    Number.isFinite(effectiveRaw) && effectiveRaw > 0
      ? Number(effectiveRaw.toFixed(2))
      : Number((okladSnapshot * (1 + hazardRateSnapshot)).toFixed(2));

  return {
    okladSnapshot: Number(okladSnapshot.toFixed(2)),
    hazardRateSnapshot,
    effectiveOkladSnapshot,
    source: String(raw.source || "manual"),
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : null,
  };
}

function createMoneySnapshot(baseOklad, source = "manual") {
  const oklad = Number(baseOklad);
  if (!(Number.isFinite(oklad) && oklad > 0)) return null;

  const hazardRateSnapshot = Number(getHazardRateByPosition(profilePosition).toFixed(4));
  const effectiveOkladSnapshot = Number((oklad * (1 + hazardRateSnapshot)).toFixed(2));

  return {
    okladSnapshot: Number(oklad.toFixed(2)),
    hazardRateSnapshot,
    effectiveOkladSnapshot,
    source,
    updatedAt: new Date().toISOString(),
  };
}

function resolveMoneySnapshotFromPayload(payload) {
  const direct = normalizeMoneySnapshot(payload?.moneySnapshot);
  if (direct) return direct;

  const calc = payload?.paySummary?.calculated;
  const fromNewCalculated = normalizeMoneySnapshot({
    okladSnapshot: calc?.okladSnapshot,
    hazardRateSnapshot: calc?.hazardRate,
    effectiveOkladSnapshot: calc?.effectiveOkladSnapshot,
    source: "legacy",
  });
  if (fromNewCalculated) return fromNewCalculated;

  const legacyFlat = payload?.paySummary;
  const fromLegacyFlat = normalizeMoneySnapshot({
    okladSnapshot: legacyFlat?.okladSnapshot,
    hazardRateSnapshot: legacyFlat?.hazardRate,
    effectiveOkladSnapshot: legacyFlat?.effectiveOkladSnapshot,
    source: "legacy",
  });
  if (fromLegacyFlat) return fromLegacyFlat;

  return null;
}

function normalizeStoredPaySummary(raw) {
  if (!raw || typeof raw !== "object") return createEmptyPaySummary();

  if ("calculated" in raw || "actual" in raw || "status" in raw) {
    const calculated = cloneCalculatedSummary(raw.calculated);
    const actual = cloneActualSummary(raw.actual);
    return {
      calculated,
      actual,
      status: "draft",
    };
  }

  const legacyCalculated = cloneCalculatedSummary({
    net: raw.net,
    tax: raw.tax,
    gross: raw.gross,
    advance: raw.advance,
    remaining: raw.remaining,
    okladSnapshot: raw.okladSnapshot,
    effectiveOkladSnapshot: raw.effectiveOkladSnapshot,
    hazardRate: raw.hazardRate,
    monthNorm: raw.monthNorm,
    personalNorm: raw.personalNorm,
    workedHours: raw.workedHours,
    workedDayHours: raw.workedDayHours,
    workedNightHours: raw.workedNightHours,
  });

  return {
    calculated: legacyCalculated,
    actual: createEmptyActualSummary(),
    status: "draft",
  };
}

function hasAnyActualValues(actual) {
  if (!actual) return false;
  return [
    actual.net,
    actual.advance,
    actual.remaining,
    actual.paidLeaveNet,
    actual.paidLeaveTax,
  ].some((x) => normalizeEnteredMoneyNumber(x) !== null);
}

function hasMainActualValues(actual) {
  if (!actual) return false;
  return [
    actual.net,
    actual.advance,
    actual.remaining,
  ].some((x) => normalizeEnteredMoneyNumber(x) !== null);
}

function hasPaidLeaveNetActualValue(actual) {
  if (!actual) return false;
  return normalizeEnteredMoneyNumber(actual.paidLeaveNet) !== null;
}

function hasTaxAdjustmentActualValue(actual) {
  if (!actual) return false;
  return normalizeEnteredMoneyNumber(actual.paidLeaveTax) !== null;
}


function hasConfirmedActual(actual) {
  return Boolean(actual?.confirmedAt) && hasAnyActualValues(actual);
}

function buildCurrentMonthSignature() {
  const snapshot = normalizeMoneySnapshot(currentMoneySnapshot);
  const normSnapshot = createNormSnapshot(currentNormProfile(), BASE_DAY_HOURS);
  return JSON.stringify({
    year,
    month,
    isHoliday: isHoliday.map((x) => Boolean(x)),
    isTransferredOff: isTransferredOff.map((x) => Boolean(x)),
    isShortDay: isShortDay.map((x) => Boolean(x)),
    dayHours: dayHours.map((x) => Number.isFinite(Number(x)) ? Number(Number(x).toFixed(2)) : 0),
    nightHours: nightHours.map((x) => Number.isFinite(Number(x)) ? Number(Number(x).toFixed(2)) : 0),
    leaveType: leaveType.map((x) => normalizeLeaveTypeLegacy(x)),
    normSnapshot,
    moneySnapshot: snapshot
      ? {
          okladSnapshot: snapshot.okladSnapshot,
          hazardRateSnapshot: snapshot.hazardRateSnapshot,
          effectiveOkladSnapshot: snapshot.effectiveOkladSnapshot,
        }
      : null,
  });
}

function computeCurrentPaySummaryStatus() {
  if (!hasAnyActualValues(currentPaySummary.actual)) return "draft";
  if (!currentPaySummary.actual.confirmedAt) return "draft";

  const signature = buildCurrentMonthSignature();
  if (currentPaySummary.actual.confirmedCalculatedSignature === signature) {
    return "actual_confirmed";
  }
  return "changed_after_confirm";
}

function parseMoneyInputValue(inputEl) {
  const raw = String(inputEl?.value ?? "").trim();
  if (!raw) return null;
  const n = parseNumber(raw);
  return normalizeEnteredMoneyNumber(n);
}

function setMoneyInputValue(inputEl, value) {
  if (!inputEl) return;
  inputEl.value = formatMoneyForInput(value);
}

function computeActualNetFromParts(advance, remaining) {
  const hasAdvance = normalizeEnteredMoneyNumber(advance) !== null;
  const hasRemaining = normalizeEnteredMoneyNumber(remaining) !== null;

  if (!hasAdvance && !hasRemaining) return null;

  const safeAdvance = hasAdvance ? Number(advance) : 0;
  const safeRemaining = hasRemaining ? Number(remaining) : 0;

  return Number((safeAdvance + safeRemaining).toFixed(2));
}

function syncActualNetInputUi() {
  if (!actualNetInput) return;

  const advance = parseMoneyInputValue(actualAdvanceInput);
  const remaining = parseMoneyInputValue(actualRemainingInput);
  const derivedNet = computeActualNetFromParts(advance, remaining);

  suppressActualInputSync = true;
  setMoneyInputValue(actualNetInput, derivedNet);
  suppressActualInputSync = false;
}

function getActualDraftFromInputs() {
  const advance = parseMoneyInputValue(actualAdvanceInput);
  const remaining = parseMoneyInputValue(actualRemainingInput);
  const derivedNet = computeActualNetFromParts(advance, remaining);

  return {
    net: derivedNet,
    advance,
    remaining,
    paidLeaveNet: parseMoneyInputValue(actualPaidLeaveNetInput),
    paidLeaveTax: parseMoneyInputValue(actualPaidLeaveTaxInput),
    confirmedAt: currentPaySummary.actual?.confirmedAt ?? null,
    confirmedCalculatedSignature: currentPaySummary.actual?.confirmedCalculatedSignature ?? null,
  };
}

function fillActualInputsFromState() {
  suppressActualInputSync = true;

  const advance = currentPaySummary.actual?.advance ?? null;
  const remaining = currentPaySummary.actual?.remaining ?? null;
  const derivedNet = computeActualNetFromParts(advance, remaining);

  setMoneyInputValue(actualNetInput, derivedNet);
  setMoneyInputValue(actualAdvanceInput, advance);
  setMoneyInputValue(actualRemainingInput, remaining);
  setMoneyInputValue(actualPaidLeaveNetInput, currentPaySummary.actual?.paidLeaveNet);
  setMoneyInputValue(actualPaidLeaveTaxInput, currentPaySummary.actual?.paidLeaveTax);

  suppressActualInputSync = false;
}

function syncActualStateFromInputs() {
  if (suppressActualInputSync) return false;

  const next = getActualDraftFromInputs();
  const prev = cloneActualSummary(currentPaySummary.actual);

  const valuesChanged =
    prev.net !== next.net ||
    prev.advance !== next.advance ||
    prev.remaining !== next.remaining ||
    prev.paidLeaveNet !== next.paidLeaveNet ||
    prev.paidLeaveTax !== next.paidLeaveTax;

  if (!valuesChanged) return false;

  currentPaySummary.actual = {
    ...next,
    confirmedAt: null,
    confirmedCalculatedSignature: null,
  };

  currentPaySummary.status = computeCurrentPaySummaryStatus();
  syncActualNetInputUi();
  return true;
}

function monthHasPaidLeaveCodes() {
  for (let i = 0; i < daysInMonth; i++) {
    const lt = normalizeLeaveTypeLegacy(leaveType[i]);
    if (lt === "vac_paid" || lt === "edu_paid" || lt === "sick") return true;
  }
  return false;
}

function monthHasAnyTimesheetEntries() {
  for (let i = 0; i < daysInMonth; i++) {
    if ((Number(dayHours[i]) || 0) > 0) return true;
    if ((Number(nightHours[i]) || 0) > 0) return true;
    if (normalizeLeaveTypeLegacy(leaveType[i])) return true;
  }
  return false;
}

function syncPaidLeaveControls() {
  const hasPaidLeaveCode = monthHasPaidLeaveCodes();
  const hasPaidLeaveNetValue = hasPaidLeaveNetActualValue(currentPaySummary.actual);

  const netEnabled = hasPaidLeaveCode || hasPaidLeaveNetValue;

  if (actualPaidLeaveNetInput) {
    actualPaidLeaveNetInput.disabled = !netEnabled;
    actualPaidLeaveNetInput.classList.toggle("opacity-60", !netEnabled);
    actualPaidLeaveNetInput.classList.toggle("cursor-not-allowed", !netEnabled);
  }

  if (actualPaidLeaveTaxInput) {
    actualPaidLeaveTaxInput.disabled = false;
    actualPaidLeaveTaxInput.classList.remove("opacity-60", "cursor-not-allowed");
  }

  if (!paidLeaveHint) return;

  if (hasPaidLeaveCode) {
    paidLeaveHint.textContent =
      "Если в табеле есть ОТ, У или Б, можно указать сумму выплаты.";
    return;
  }

  if (hasPaidLeaveNetValue) {
    paidLeaveHint.textContent =
      "Сумма выплаты сохранена, но сейчас в табеле нет кодов ОТ, У или Б. Проверьте месяц.";
    return;
  }

  paidLeaveHint.textContent =
    "Поле с отпускными и пр. станет доступно, когда в табеле появится код ОТ, У или Б.";
}


function applyTableOkladVisibility() {
  if (!okladInput) return;
  okladInput.type = okladVisible ? "text" : "password";

  if (!okladPeekBtn) return;
  okladPeekBtn.innerHTML = okladVisible ? EYE_OFF_ICON : EYE_ICON;
  okladPeekBtn.setAttribute("aria-label", okladVisible ? "Скрыть оклад" : "Показать оклад");
}

function applyTablePayVisibility() {
  if (payResultsWrap) {
    payResultsWrap.classList.toggle("is-hidden", !payVisible);
  }

  if (!payPeekBtn) return;

  setRevealButtonState({
    hidden: !payVisible,
    button: payPeekBtn,
    textEl: payPeekText,
    iconEl: payPeekIcon,
    showText: "Показать",
    hideText: "Скрыть",
    showAria: "Показать выплаты",
    hideAria: "Скрыть выплаты",
  });
}

function syncTableMoneyUi() {
  const protectedMoney = isMoneyProtectionEnabled(moneyProfile);

  if (!protectedMoney) {
    okladVisible = true;
    payVisible = true;
  }

  applyTableOkladVisibility();
  applyTablePayVisibility();
}

function setupTableMoneyControls() {
  okladPeekBtn = replaceElementWithClone(okladPeekBtnInitial);
  payPeekBtn = replaceElementWithClone(payPeekBtnInitial);

  okladPeekBtn?.addEventListener("click", async (e) => {
    e.preventDefault();

    if (!okladVisible && isMoneyProtectionEnabled(moneyProfile)) {
      const ok = await ensureTableMoneyAccess();
      if (!ok) return;
    }

    okladVisible = !okladVisible;
    applyTableOkladVisibility();
  });

  payPeekBtn?.addEventListener("click", async () => {
    if (!payVisible && isMoneyProtectionEnabled(moneyProfile)) {
      const ok = await ensureTableMoneyAccess();
      if (!ok) return;
    }

    payVisible = !payVisible;
    applyTablePayVisibility();
  });

  syncTableMoneyUi();
}

function setupActualMoneyControls() {
  const actualInputs = [
    actualAdvanceInput,
    actualRemainingInput,
    actualPaidLeaveNetInput,
    actualPaidLeaveTaxInput,
  ].filter(Boolean);

  for (const input of actualInputs) {
    input.addEventListener("input", () => {
      const sanitized = sanitizeNumericValue(input.value);
      if (sanitized !== input.value) input.value = sanitized;

      syncActualNetInputUi();

      const changed = syncActualStateFromInputs();
      if (!changed) return;

      recalcAll();
      scheduleSave();
    });
  }

  fillActualFromCalcBtn?.addEventListener("click", () => {
    const calc = currentPaySummary.calculated;
    if (!calc) {
      setError("Сначала нужен авторасчёт месяца.");
      return;
    }

    suppressActualInputSync = true;
    setMoneyInputValue(actualAdvanceInput, calc.advance);
    setMoneyInputValue(actualRemainingInput, calc.remaining);
    setMoneyInputValue(actualPaidLeaveNetInput, currentPaySummary.actual?.paidLeaveNet);
    setMoneyInputValue(actualPaidLeaveTaxInput, currentPaySummary.actual?.paidLeaveTax);
    suppressActualInputSync = false;

    syncActualNetInputUi();
    syncActualStateFromInputs();
    setError(null);
    recalcAll();
    scheduleSave();
  });

  confirmActualBtn?.addEventListener("click", async () => {
    const changed = syncActualStateFromInputs();
    if (changed) {
      recalcAll();
    }

    if (!hasAnyActualValues(currentPaySummary.actual)) {
      setError("Введите хотя бы одну фактическую сумму перед подтверждением.");
      return;
    }

    currentPaySummary.actual.confirmedAt = new Date().toISOString();
    currentPaySummary.actual.confirmedCalculatedSignature = buildCurrentMonthSignature();
    currentPaySummary.status = computeCurrentPaySummaryStatus();

    setError(null);
    recalcAll();
    await doSaveTimesheet();
  });

  clearActualBtn?.addEventListener("click", () => {
    currentPaySummary.actual = createEmptyActualSummary();
    currentPaySummary.status = computeCurrentPaySummaryStatus();
    fillActualInputsFromState();
    syncActualNetInputUi();
    setError(null);
    recalcAll();
    scheduleSave();
  });
}

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
  let weekdays = 0;
  let holidayWeekdays = 0;
  let transferredWeekdays = 0;
  let shortWeekdays = 0;

  for (let i = 0; i < daysInMonth; i++) {
    if (isWeekendByIndex(year, month, i)) continue;
    weekdays++;

    if (isHoliday[i]) holidayWeekdays++;
    else if (isTransferredOff[i]) transferredWeekdays++;
    else if (isShortDay[i]) shortWeekdays++;
  }

  return (
    weekdays * BASE_DAY_HOURS -
    holidayWeekdays * BASE_DAY_HOURS -
    transferredWeekdays * BASE_DAY_HOURS -
    shortWeekdays * SHORT_DAY_REDUCTION_HOURS
  );
}

function normHoursForDay(index, baseDayHours = BASE_DAY_HOURS) {
  if (isWeekendByIndex(year, month, index)) return 0;
  if (isHoliday[index] || isTransferredOff[index]) return 0;
  return Math.max(0, baseDayHours - (isShortDay[index] ? SHORT_DAY_REDUCTION_HOURS : 0));
}

function startOfLocalDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function paymentMonthKey(y, m) {
  return `${y}-${String(m).padStart(2, "0")}`;
}

function snapshotCurrentPaymentMarks() {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !daysInMonth) return;
  if (isHoliday.length !== daysInMonth || isTransferredOff.length !== daysInMonth) return;
  paymentMarksCache.set(paymentMonthKey(year, month), {
    isHoliday: isHoliday.map((x) => Boolean(x)),
    isTransferredOff: isTransferredOff.map((x) => Boolean(x)),
  });
}

function normalizePaymentMarks(payload, y, m) {
  const length = new Date(y, m + 1, 0).getDate();
  const holidays = Array.isArray(payload?.isHoliday) && payload.isHoliday.length === length
    ? payload.isHoliday
    : new Array(length).fill(false);
  const transferred = Array.isArray(payload?.isTransferredOff) && payload.isTransferredOff.length === length
    ? payload.isTransferredOff
    : new Array(length).fill(false);

  return {
    isHoliday: holidays.map((x) => Boolean(x)),
    isTransferredOff: transferred.map((x) => Boolean(x)),
  };
}

async function getPaymentMarksForMonth(y, m) {
  if (y === year && m === month) {
    return {
      isHoliday: isHoliday.map((x) => Boolean(x)),
      isTransferredOff: isTransferredOff.map((x) => Boolean(x)),
    };
  }

  const key = paymentMonthKey(y, m);
  if (paymentMarksCache.has(key)) return paymentMarksCache.get(key);

  try {
    const payload = await loadTimesheet(y, m);
    const marks = normalizePaymentMarks(payload, y, m);
    paymentMarksCache.set(key, marks);
    return marks;
  } catch {
    const marks = normalizePaymentMarks(null, y, m);
    paymentMarksCache.set(key, marks);
    return marks;
  }
}

async function isPaymentNonWorkingDate(date) {
  const d = new Date(date);
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return true;

  const marks = await getPaymentMarksForMonth(d.getFullYear(), d.getMonth());
  const idx = d.getDate() - 1;
  return Boolean(marks?.isHoliday?.[idx] || marks?.isTransferredOff?.[idx]);
}

async function resolvePaymentDate(rawDate) {
  const resolved = startOfLocalDay(rawDate);
  let guard = 20;

  while (guard > 0 && await isPaymentNonWorkingDate(resolved)) {
    resolved.setDate(resolved.getDate() - 1);
    guard -= 1;
  }

  return resolved;
}

function formatPaymentDate(date) {
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

function paymentTypeLabel(type) {
  return type === "advance" ? "Аванс" : "Остаток";
}

async function findNearestPayment(now = new Date()) {
  const today = startOfLocalDay(now);
  const candidates = [];

  for (let offset = 0; offset <= 4; offset += 1) {
    const base = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    const items = [
      { type: "remaining", rawDate: new Date(base.getFullYear(), base.getMonth(), REMAINING_PAYMENT_DAY) },
      { type: "advance", rawDate: new Date(base.getFullYear(), base.getMonth(), ADVANCE_PAYMENT_DAY) },
    ];

    for (const item of items) {
      const paymentDate = await resolvePaymentDate(item.rawDate);
      if (paymentDate >= today) {
        candidates.push({ ...item, paymentDate });
      }
    }
  }

  candidates.sort((a, b) => a.paymentDate - b.paymentDate);
  return candidates[0] ?? null;
}

function renderPaymentCountdown(payment, now = new Date()) {
  if (!paymentCountdownCard || !paymentCountdownValue || !paymentCountdownHint) return;

  if (!payment) {
    paymentCountdownValue.textContent = "—";
    paymentCountdownHint.textContent = "Не удалось определить ближайшую выплату";
    paymentCountdownCard.classList.remove("is-today");
    return;
  }

  const today = startOfLocalDay(now);
  const paymentDay = startOfLocalDay(payment.paymentDate);
  const isToday = paymentDay.getTime() === today.getTime();
  const type = paymentTypeLabel(payment.type);
  const moved = startOfLocalDay(payment.rawDate).getTime() !== paymentDay.getTime();
  const moveText = moved ? ` · перенос с ${formatPaymentDate(payment.rawDate)}` : "";

  paymentCountdownCard.classList.toggle("is-today", isToday);
  paymentCountdownHint.textContent = `${type} — ${formatPaymentDate(payment.paymentDate)}${moveText}`;

  if (isToday) {
    paymentCountdownValue.textContent = "Ожидайте выплату сегодня";
    return;
  }

  const diffMs = Math.max(0, paymentDay.getTime() - now.getTime());
  const totalHours = Math.max(1, Math.ceil(diffMs / (60 * 60 * 1000)));
  const daysLeft = Math.floor(totalHours / 24);
  const hoursLeft = totalHours % 24;

  paymentCountdownValue.textContent = `${daysLeft} д ${hoursLeft} ч`;
}

async function updatePaymentCountdown() {
  if (!paymentCountdownCard) return;
  const runId = ++paymentCountdownRunId;
  snapshotCurrentPaymentMarks();

  const now = new Date();
  const payment = await findNearestPayment(now);
  if (runId !== paymentCountdownRunId) return;
  renderPaymentCountdown(payment, now);
}

function requestPaymentCountdownUpdate() {
  void updatePaymentCountdown();
}

function startPaymentCountdownTimer() {
  if (paymentCountdownTimer) return;
  requestPaymentCountdownUpdate();
  paymentCountdownTimer = window.setInterval(requestPaymentCountdownUpdate, 60 * 1000);
}

function getPreviousVacationPayMonths(baseYear, baseMonth) {
  const months = [];
  for (let offset = VACATION_PAY_MONTHS_REQUIRED; offset >= 1; offset -= 1) {
    const dt = new Date(baseYear, baseMonth - offset, 1);
    months.push({ year: dt.getFullYear(), month: dt.getMonth() });
  }
  return months;
}

function monthKey(y, m) {
  return `${y}-${String(m).padStart(2, "0")}`;
}

function formatMonthShort(y, m) {
  return `${monthNames[m].slice(0, 3).toLowerCase()} ${y}`;
}

function formatVacationPayPeriod(months) {
  if (!months.length) return "";
  const first = months[0];
  const last = months[months.length - 1];
  return `${formatMonthShort(first.year, first.month)} — ${formatMonthShort(last.year, last.month)}`;
}

function buildVacationPayPeriodLabelFromRows(rows) {
  const months = (rows ?? [])
    .map((row) => ({ year: Number(row?.year), month: Number(row?.month) }))
    .filter((item) => Number.isInteger(item.year) && Number.isInteger(item.month))
    .sort((a, b) => a.year - b.year || a.month - b.month);

  return formatVacationPayPeriod(months);
}

function formatRuDays(value) {
  const n = Math.abs(Number(value));
  const lastTwo = n % 100;
  const last = n % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return "дней";
  if (last === 1) return "день";
  if (last >= 2 && last <= 4) return "дня";
  return "дней";
}

function isVacationCalendarBridgeDay(index) {
  return isWeekendByIndex(year, month, index) || Boolean(isHoliday[index] || isTransferredOff[index]);
}

function countCurrentVacationPayDays() {
  const periods = [];
  let active = null;

  for (let i = 0; i < daysInMonth; i += 1) {
    if (normalizeLeaveTypeLegacy(leaveType[i]) !== "vac_paid") continue;

    if (!active) {
      active = { start: i, end: i };
      continue;
    }

    let canBridge = true;
    for (let gap = active.end + 1; gap < i; gap += 1) {
      if (!isVacationCalendarBridgeDay(gap)) {
        canBridge = false;
        break;
      }
    }

    if (canBridge) {
      active.end = i;
    } else {
      periods.push(active);
      active = { start: i, end: i };
    }
  }

  if (active) periods.push(active);

  let payableDays = 0;
  for (const period of periods) {
    for (let i = period.start; i <= period.end; i += 1) {
      if (isHoliday[i]) continue;
      payableDays += 1;
    }
  }

  return payableDays;
}

function extractConfirmedVacationPayIncome(payload) {
  const actual = normalizeStoredPaySummary(payload?.paySummary).actual;
  if (!hasConfirmedActual(actual)) return null;

  const netFromParts = computeActualNetFromParts(actual.advance, actual.remaining);
  const baseNet = normalizeMoneyNumber(actual.net) ?? netFromParts ?? 0;
  const paidLeaveNet = normalizeMoneyNumber(actual.paidLeaveNet) ?? 0;
  const total = Number(baseNet) + Number(paidLeaveNet);

  return total > 0 ? Number(total.toFixed(2)) : null;
}

async function getVacationPayHistoryRows(baseYear, baseMonth) {
  const key = monthKey(baseYear, baseMonth);
  if (!vacationPayHistoryCache.has(key)) {
    vacationPayHistoryCache.set(
      key,
      listMyTimesheetsBefore(baseYear, baseMonth, { withPayload: true }).catch((error) => {
        vacationPayHistoryCache.delete(key);
        throw error;
      })
    );
  }

  return vacationPayHistoryCache.get(key);
}

async function calculateVacationPayEstimate(baseYear, baseMonth, vacationDays) {
  const months = getPreviousVacationPayMonths(baseYear, baseMonth);
  const rows = await getVacationPayHistoryRows(baseYear, baseMonth);
  const rowsByMonth = new Map((rows ?? []).map((row) => [monthKey(row.year, row.month), row]));

  let totalIncome = 0;
  let confirmedMonths = 0;
  let fallbackTotalIncome = 0;
  const fallbackRows = [];

  for (const item of months) {
    const row = rowsByMonth.get(monthKey(item.year, item.month));
    const income = extractConfirmedVacationPayIncome(row?.payload);
    if (!Number.isFinite(income)) continue;
    totalIncome += income;
    confirmedMonths += 1;
  }

  for (const row of rows ?? []) {
    const income = extractConfirmedVacationPayIncome(row?.payload);
    if (!Number.isFinite(income)) continue;
    fallbackRows.push(row);
    fallbackTotalIncome += income;
    if (fallbackRows.length >= VACATION_PAY_MONTHS_REQUIRED) break;
  }

  const requestedPeriodText = formatVacationPayPeriod(months);

  if (confirmedMonths < VACATION_PAY_MONTHS_REQUIRED) {
    if (fallbackRows.length >= VACATION_PAY_MONTHS_REQUIRED) {
      const averageDaily = fallbackTotalIncome / (VACATION_PAY_MONTHS_REQUIRED * VACATION_PAY_AVERAGE_CALENDAR_DAYS);
      return {
        ok: true,
        fallback: true,
        vacationDays,
        confirmedMonths,
        periodText: buildVacationPayPeriodLabelFromRows(fallbackRows),
        requestedPeriodText,
        averageDaily,
        amount: averageDaily * vacationDays,
      };
    }

    return {
      ok: false,
      vacationDays,
      confirmedMonths,
      periodText: requestedPeriodText,
    };
  }

  // Бета-упрощение: используем подтвержденные суммы "на руки" и среднее 29,3 календарного дня.
  const averageDaily = totalIncome / (VACATION_PAY_MONTHS_REQUIRED * VACATION_PAY_AVERAGE_CALENDAR_DAYS);
  return {
    ok: true,
    fallback: false,
    vacationDays,
    confirmedMonths,
    periodText: requestedPeriodText,
    averageDaily,
    amount: averageDaily * vacationDays,
  };
}

function renderVacationPayEstimateIdle() {
  if (vacationPayEstimateEl) {
    vacationPayEstimateEl.textContent = "—";
    vacationPayEstimateEl.dataset.value = "";
  }
  if (vacationPayEstimateHint) {
    vacationPayEstimateHint.textContent = "Поставьте ОТ";
  }
}

function renderVacationPayEstimateLoading(vacationDays) {
  if (vacationPayEstimateEl) {
    vacationPayEstimateEl.textContent = "Считаю...";
    vacationPayEstimateEl.dataset.value = "";
  }
  if (vacationPayEstimateHint) {
    vacationPayEstimateHint.textContent = `${vacationDays} ${formatRuDays(vacationDays)} ОТ`;
  }
}

function renderVacationPayEstimateResult(result) {
  if (!result?.ok) {
    if (vacationPayEstimateEl) {
      vacationPayEstimateEl.textContent = "Нет 12 мес. факта";
      vacationPayEstimateEl.dataset.value = "";
    }
    if (vacationPayEstimateHint) {
      vacationPayEstimateHint.textContent =
        `Нужны: ${result?.periodText || "12 прошлых мес."}, есть ${result?.confirmedMonths ?? 0}/12`;
    }
    return;
  }

  if (vacationPayEstimateEl) {
    animateNumber(vacationPayEstimateEl, result.amount, (v) => `~ ${formatRub(v, 0)}`, 420);
  }
  if (vacationPayEstimateHint) {
    vacationPayEstimateHint.textContent =
      result.fallback
        ? `Бета: по последним 12 фактам, ${result.periodText}`
        : `Бета: ${result.vacationDays} ${formatRuDays(result.vacationDays)}, ${result.periodText}`;
  }
}

function requestVacationPayEstimateUpdate() {
  if (!vacationPayEstimateEl) return;

  const runId = ++vacationPayEstimateRunId;
  const vacationDays = countCurrentVacationPayDays();

  if (vacationDays <= 0) {
    renderVacationPayEstimateIdle();
    return;
  }

  renderVacationPayEstimateLoading(vacationDays);

  void calculateVacationPayEstimate(year, month, vacationDays)
    .then((result) => {
      if (runId !== vacationPayEstimateRunId) return;
      renderVacationPayEstimateResult(result);
    })
    .catch(() => {
      if (runId !== vacationPayEstimateRunId) return;
      if (vacationPayEstimateEl) {
        vacationPayEstimateEl.textContent = "Ошибка";
        vacationPayEstimateEl.dataset.value = "";
      }
      if (vacationPayEstimateHint) {
        vacationPayEstimateHint.textContent = "Не удалось проверить прошлые месяцы";
      }
    });
}

function parseIsoDateLocal(value) {
  const match = String(value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const y = Number(match[1]);
  const m = Number(match[2]) - 1;
  const d = Number(match[3]);
  const date = new Date(y, m, d);

  if (date.getFullYear() !== y || date.getMonth() !== m || date.getDate() !== d) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function applyEmploymentDateDefaults() {
  const employmentDate = parseIsoDateLocal(profileEmploymentDate);
  if (!employmentDate) return;

  for (let i = 0; i < daysInMonth; i++) {
    const date = new Date(year, month, i + 1);
    date.setHours(0, 0, 0, 0);
    if (date >= employmentDate) continue;
    if (normHoursForDay(i) <= 0) continue;
    if (normalizeLeaveTypeLegacy(leaveType[i])) continue;
    if ((Number(dayHours[i]) || 0) > 0 || (Number(nightHours[i]) || 0) > 0) continue;

    leaveType[i] = NOT_EMPLOYED_LEAVE_TYPE;
  }
}

function isDismissedLeaveType(leaveTypeValue) {
  return normalizeLeaveTypeLegacy(leaveTypeValue) === DISMISSED_LEAVE_TYPE;
}

function isNormAffectingLeaveType(leaveTypeValue) {
  const leave = normalizeLeaveTypeLegacy(leaveTypeValue);
  return Boolean(leave && leave !== DISMISSED_LEAVE_TYPE);
}

function findDismissalIndex() {
  if (dismissedBeforeMonth) return -1;
  return leaveType.findIndex((leave) => isDismissedLeaveType(leave));
}

function payloadHasDismissal(payload) {
  if (!payload || !Array.isArray(payload.leaveType)) return false;
  return payload.leaveType.some((leave) => isDismissedLeaveType(leave));
}

async function refreshDismissalBeforeMonth() {
  dismissedBeforeMonth = false;

  const rows = await listMyTimesheetsBefore(year, month, { withPayload: true });
  dismissedBeforeMonth = rows.some((row) => payloadHasDismissal(row?.payload));
}

function personalNormHours(monthNorm) {
  let otTotal = 0, sickTotal = 0, unpaidTotal = 0, eduTotal = 0, notEmployedTotal = 0, effectiveLeaveHours = 0;
  for (let i = 0; i < daysInMonth; i++) {
    const lt = normalizeLeaveTypeLegacy(leaveType[i]);
    if (!lt) continue;
    if (lt === "vac_paid") otTotal++;
    else if (lt === "sick") sickTotal++;
    else if (lt === "vac_unpaid" || lt === "vac_unpaid_required") unpaidTotal++;
    else if (lt === "edu_paid" || lt === "edu_unpaid") eduTotal++;
    else if (lt === NOT_EMPLOYED_LEAVE_TYPE) notEmployedTotal++;
    if (lt !== DISMISSED_LEAVE_TYPE) effectiveLeaveHours += normHoursForDay(i, LEAVE_HOURS_PER_DAY);
  }
  const personalNorm = Math.max(0, monthNorm - effectiveLeaveHours);
  return { otTotal, sickTotal, unpaidTotal, eduTotal, notEmployedTotal, personalNorm };
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

function firstHalfStats() {
  const endIdx = Math.min(14, daysInMonth - 1);
  let weekdays = 0;
  let holidayWD = 0;
  let transferredWD = 0;
  let shortWD = 0;
  let leaveEffectiveHours = 0;

  for (let i = 0; i <= endIdx; i++) {
    if (isWeekendByIndex(year, month, i)) continue;
    weekdays++;

    if (isHoliday[i]) holidayWD++;
    else if (isTransferredOff[i]) transferredWD++;
    else if (isShortDay[i]) shortWD++;

    if (isNormAffectingLeaveType(leaveType[i])) {
      leaveEffectiveHours += normHoursForDay(i, LEAVE_HOURS_PER_DAY);
    }
  }

  const monthHalfNorm =
    weekdays * BASE_DAY_HOURS -
    holidayWD * BASE_DAY_HOURS -
    transferredWD * BASE_DAY_HOURS -
    shortWD * SHORT_DAY_REDUCTION_HOURS;

  const personalHalfNorm = Math.max(0, monthHalfNorm - leaveEffectiveHours);
  const workedFH = sumRange(dayHours, 0, endIdx) + sumRange(nightHours, 0, endIdx);

  return { personalHalfNorm, workedFH };
}

function setBadgeState(el, tone, text) {
  if (!el) return;
  el.textContent = text;
  el.classList.remove(
    "bg-white/5","text-slate-300","ring-white/10",
    "bg-emerald-500/10","text-emerald-200","ring-emerald-400/20",
    "bg-amber-500/10","text-amber-200","ring-amber-400/20",
    "bg-rose-500/10","text-rose-200","ring-rose-400/20"
  );

  if (tone === "ok") {
    el.classList.add("bg-emerald-500/10","text-emerald-200","ring-emerald-400/20");
    return;
  }
  if (tone === "warn") {
    el.classList.add("bg-amber-500/10","text-amber-200","ring-amber-400/20");
    return;
  }
  if (tone === "err") {
    el.classList.add("bg-rose-500/10","text-rose-200","ring-rose-400/20");
    return;
  }

  el.classList.add("bg-white/5","text-slate-300","ring-white/10");
}

function renderMonthStatusUi() {
  const hasActual = hasAnyActualValues(currentPaySummary.actual);
  const status = currentPaySummary.status;

  if (!hasActual) {
    setBadgeState(monthStatusBadge, "neutral", "Черновик");
    return;
  }
  if (status === "actual_confirmed") {
    setBadgeState(monthStatusBadge, "ok", "Факт подтверждён");
    return;
  }
  if (status === "changed_after_confirm") {
    setBadgeState(monthStatusBadge, "warn", "Изменён после факта");
    return;
  }
  setBadgeState(monthStatusBadge, "neutral", "Факт не подтверждён");
}

function renderActualHintUi() {
  if (!actualConfirmHint) return;

  if (!hasAnyActualValues(currentPaySummary.actual)) {
    actualConfirmHint.textContent =
      "Можно вручную ввести реальные суммы после получения зарплаты, аванса, отпускных или больничного, а затем нажать «Подтвердить факт».";
    return;
  }

  if (!currentPaySummary.actual.confirmedAt) {
    actualConfirmHint.textContent =
      "Фактические суммы сейчас сохранены как черновик. Пока вы не нажмёте «Подтвердить факт», в годовых итогах будет использоваться авторасчёт, а не введённые вами суммы.";
    return;
  }

  if (currentPaySummary.status === "changed_after_confirm") {
    actualConfirmHint.textContent =
      `Фактические суммы были подтверждены ${formatDateTime(currentPaySummary.actual.confirmedAt)}, но после этого табель изменили. Если введённые суммы всё ещё верны, нажмите «Подтвердить факт» ещё раз.`;
    return;
  }

  actualConfirmHint.textContent =
    `Фактические суммы подтверждены: ${formatDateTime(currentPaySummary.actual.confirmedAt)}. Именно они будут использоваться в итогах.`;
}

function renderPayWarnings(calculated) {
  if (!payWarningsBox) return;

  const warnings = [];
  const actual = currentPaySummary.actual;
  const confirmed = hasConfirmedActual(actual);

  const hasMainFact = hasMainActualValues(actual);
  const hasPaidLeaveCode = monthHasPaidLeaveCodes();
  const hasPaidLeaveNetFact = hasPaidLeaveNetActualValue(actual);

  if (hasMainFact && !actual.confirmedAt) {
    warnings.push({
      tone: "neutral",
      text: "Фактические суммы заполнены как черновик. Пока вы не нажмёте «Подтвердить факт», в годовых итогах используется авторасчёт.",
    });
  }

  if (currentPaySummary.status === "changed_after_confirm") {
    warnings.push({
      tone: "warn",
      text: "После подтверждения фактических сумм табель был изменён. Проверьте месяц и, если нужно, подтвердите факт заново.",
    });
  }

  if (hasAnyActualValues(actual) && !monthHasAnyTimesheetEntries()) {
    warnings.push({
      tone: "warn",
      text: "В месяце почти нет данных табеля, но фактические суммы уже указаны.",
    });
  }

  if (hasPaidLeaveNetFact && !hasPaidLeaveCode) {
    warnings.push({
      tone: "warn",
      text: "Указана сумма за отпуск, учебный отпуск или больничный, но в табеле нет кодов ОТ, У или Б.",
    });
  }

  if (hasPaidLeaveCode && !hasPaidLeaveNetFact) {
    warnings.push({
      tone: "warn",
      text: "В табеле есть код ОТ, У или Б, но сумма выплаты не указана. Из-за этого сумма за месяц и год может быть неточной.",
    });
  }

  if (
    confirmed &&
    calculated &&
    normalizeEnteredMoneyNumber(actual?.net) !== null &&
    Number.isFinite(calculated?.net)
  ) {
    const diff = Math.abs(Number(actual.net) - Number(calculated.net));
    if (diff >= 1) {
      warnings.push({
        tone: "neutral",
        text: `Фактическая зарплата отличается от авторасчёта на ${formatRub(diff, 0)}.`,
      });
    }
  }

  if (!warnings.length) {
    payWarningsBox.classList.add("hidden");
    payWarningsBox.innerHTML = "";
    return;
  }

  payWarningsBox.classList.remove("hidden");
  payWarningsBox.innerHTML = warnings.map((item) => {
    const cls =
      item.tone === "warn"
        ? "border-amber-400/20 bg-amber-500/10 text-amber-100"
        : item.tone === "err"
          ? "border-rose-400/20 bg-rose-500/10 text-rose-100"
          : "border-white/10 bg-white/5 text-slate-200";
    return `<div class="rounded-2xl border px-4 py-3 text-sm ${cls}">${item.text}</div>`;
  }).join("");
}


function setTextValue(el, value) {
  if (!el) return;
  el.textContent = value;
}

function grossToNet(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n * (1 - TAX_RATE);
}

function clearCalculatedMoneyUi() {
  for (const el of [
    hourRateNetEl,
    nightHourNetEl,
    holidayExtraGrossEl,
    baseFactGrossEl,
    bonusGrossEl,
    nightExtraGrossEl,
    grossPayEl,
  ]) {
    if (el) el.textContent = "—";
  }
}

function renderMoneyUi(calculated) {
  const actual = currentPaySummary.actual;
  const confirmed = hasConfirmedActual(actual);

  const confirmedNet = confirmed ? normalizeMoneyNumber(actual.net) : null;
  const confirmedAdvance = confirmed ? normalizeMoneyNumber(actual.advance) : null;
  const confirmedRemaining = confirmed ? normalizeMoneyNumber(actual.remaining) : null;
  const confirmedPaidLeaveNet = confirmed ? (normalizeMoneyNumber(actual.paidLeaveNet) ?? 0) : 0;
const confirmedTaxOverride = confirmed ? normalizeMoneyNumber(actual.paidLeaveTax) : null;

const displayNetBase =
  Number.isFinite(confirmedNet)
    ? confirmedNet
    : Number.isFinite(calculated?.net)
      ? calculated.net
      : null;

const displayNet =
  Number.isFinite(displayNetBase)
    ? Number((displayNetBase + confirmedPaidLeaveNet).toFixed(2))
    : confirmedPaidLeaveNet > 0
      ? confirmedPaidLeaveNet
      : null;

const displayAdvance =
  Number.isFinite(confirmedAdvance)
    ? confirmedAdvance
    : Number.isFinite(calculated?.advance)
      ? calculated.advance
      : null;

const displayRemaining =
  Number.isFinite(confirmedRemaining)
    ? confirmedRemaining
    : Number.isFinite(calculated?.remaining)
      ? calculated.remaining
      : null;

const displayTax =
  confirmedTaxOverride !== null
    ? confirmedTaxOverride
    : Number.isFinite(calculated?.tax)
      ? calculated.tax
      : null;

  if (Number.isFinite(displayNet)) {
    animateNumber(netPayEl, displayNet, (v) => formatRub(v, 0), 520);
    bump(netPayEl);
  } else if (netPayEl) {
    netPayEl.textContent = "—";
    netPayEl.dataset.value = "";
  }

  if (Number.isFinite(displayTax)) {
    animateNumber(taxPayEl, displayTax, (v) => formatRub(v, 0), 360);
  } else if (taxPayEl) {
    taxPayEl.textContent = "—";
  }

  if (Number.isFinite(displayAdvance)) {
    const prefix = Number.isFinite(confirmedAdvance) ? "" : "~ ";
    advancePayEl.textContent = `${prefix}${formatRub(displayAdvance, 0)}`;
  } else if (advancePayEl) {
    advancePayEl.textContent = "—";
  }

  if (Number.isFinite(displayRemaining)) {
    const prefix = Number.isFinite(confirmedRemaining) ? "" : "~ ";
    remainingPayEl.textContent = `${prefix}${formatRub(displayRemaining, 0)}`;
  } else if (remainingPayEl) {
    remainingPayEl.textContent = "—";
  }

  if (Number.isFinite(calculated?.hourRateNet)) {
    animateNumber(hourRateNetEl, calculated.hourRateNet, (v) => formatRub(v, 0), 360);
  } else {
    setTextValue(hourRateNetEl, "—");
  }

  if (Number.isFinite(calculated?.nightHourNet)) {
    animateNumber(nightHourNetEl, calculated.nightHourNet, (v) => formatRub(v, 0), 360);
  } else {
    setTextValue(nightHourNetEl, "—");
  }

  const baseFactNet = grossToNet(calculated?.baseFactGross);
  const bonusNet = grossToNet(calculated?.bonusGross);
  const nightExtraNet = grossToNet(calculated?.nightExtraGross);
  const holidayExtraNet = grossToNet(calculated?.holidayExtraGross);

  if (Number.isFinite(baseFactNet)) {
    animateNumber(baseFactGrossEl, baseFactNet, (v) => formatRub(v, 0), 360);
  } else {
    setTextValue(baseFactGrossEl, "—");
  }

  if (Number.isFinite(bonusNet)) {
    animateNumber(bonusGrossEl, bonusNet, (v) => formatRub(v, 0), 360);
  } else {
    setTextValue(bonusGrossEl, "—");
  }

  if (Number.isFinite(nightExtraNet)) {
    animateNumber(nightExtraGrossEl, nightExtraNet, (v) => formatRub(v, 0), 360);
  } else {
    setTextValue(nightExtraGrossEl, "—");
  }

  if (Number.isFinite(holidayExtraNet)) {
    animateNumber(holidayExtraGrossEl, holidayExtraNet, (v) => formatRub(v, 0), 360);
  } else {
    setTextValue(holidayExtraGrossEl, "—");
  }

  if (Number.isFinite(calculated?.net)) {
    animateNumber(grossPayEl, calculated.net, (v) => formatRub(v, 0), 360);
  } else {
    clearCalculatedMoneyUi();
    setTextValue(grossPayEl, "—");
  }

  const parts = [];

  if (confirmed) {
    parts.push(
      currentPaySummary.status === "changed_after_confirm"
        ? "Показаны подтверждённые фактические суммы, но табель позже менялся."
        : "Показаны подтверждённые фактические суммы."
    );

    if (confirmedPaidLeaveNet > 0) {
      parts.push(`Отпуск / учёба / больничный: ${formatRub(confirmedPaidLeaveNet, 0)}.`);
    }
  } else if (calculated) {
    const hazardText =
      calculated.hazardRate > 0
        ? ` • Вредность: +${(calculated.hazardRate * 100).toFixed(0)}%`
        : "";

    parts.push(
      `Авторасчёт на руки: ${formatRub(calculated.net, 0)} • Налог: ${formatRub(calculated.tax, 0)} • Праздничные x2 на руки: ${formatRub(holidayExtraNet, 0)}${hazardText}`
    );
  }

  if (!parts.length && confirmedPaidLeaveNet > 0) {
    parts.push(`Подтверждены только выплаты за отпуск / учёбу / больничный: ${formatRub(confirmedPaidLeaveNet, 0)}.`);
  }

  moneySummaryEl.textContent = parts.join(" ");
}

function getResolvedBaseOklad() {
  const snapshotOklad = Number(currentMoneySnapshot?.okladSnapshot);
  if (Number.isFinite(snapshotOklad) && snapshotOklad > 0) return snapshotOklad;

  const inputOklad = parseNumber(okladInput?.value);
  if (Number.isFinite(inputOklad) && inputOklad > 0) return inputOklad;

  return null;
}

function getResolvedHazardRate() {
  const snap = Number(currentMoneySnapshot?.hazardRateSnapshot);
  if (Number.isFinite(snap)) return snap;
  return getHazardRateByPosition(profilePosition);
}

function recalcAll() {
  if (monthYearDisplay) monthYearDisplay.textContent = `${monthNames[month]} ${year}`;
  requestPaymentCountdownUpdate();

  const monthNorm = calendarNormHours();
  const { personalNorm } = personalNormHours(monthNorm);
  const totalDay = sumArr(dayHours);
  const totalNight = sumArr(nightHours);
  const workedHours = totalDay + totalNight;

  animateNumber(totalHoursEl, workedHours, (v) => v.toFixed(1), 360);
  if (dayNightHoursEl) {
    dayNightHoursEl.textContent = `${totalDay.toFixed(1)} / ${totalNight.toFixed(1)}`;
    bump(dayNightHoursEl);
  }
  animateNumber(normMonthEl, monthNorm, (v) => v.toFixed(1), 360);
  animateNumber(normEffectiveEl, personalNorm, (v) => v.toFixed(1), 360);
  animateNumber(overtimeEl, workedHours - personalNorm, (v) => (v >= 0 ? "+" : "") + v.toFixed(1), 360);
  requestVacationPayEstimateUpdate();

  const { personalHalfNorm, workedFH } = firstHalfStats();
  if (normFirstHalfEl) normFirstHalfEl.textContent = personalHalfNorm.toFixed(1);
  if (workedFirstHalfEl) workedFirstHalfEl.textContent = workedFH.toFixed(1);

  syncPaidLeaveControls();

  const baseOklad = getResolvedBaseOklad();
  let calculated = null;

  if (!(monthNorm > 0)) {
    setError("Норма месяца стала ≤ 0. Проверьте праздники/сокращённые дни.");
    if (normHint) normHint.textContent = "";
    currentPaySummary.calculated = null;
    currentPaySummary.status = computeCurrentPaySummaryStatus();
    renderMoneyUi(null);
    renderMonthStatusUi();
    renderActualHintUi();
    renderPayWarnings(null);
    return;
  }

  if (!Number.isFinite(baseOklad) || baseOklad <= 0) {
    setError(null);
    if (normHint) normHint.textContent = `Норма месяца: ${monthNorm.toFixed(1)} ч`;
    currentPaySummary.calculated = null;
    currentPaySummary.status = computeCurrentPaySummaryStatus();
    renderMoneyUi(null);
    renderMonthStatusUi();
    renderActualHintUi();
    renderPayWarnings(null);
    return;
  }

  setError(null);

  const hazardRate = getResolvedHazardRate();
  const effectiveOklad = Number(
    (
      Number(currentMoneySnapshot?.effectiveOkladSnapshot) ||
      (baseOklad * (1 + hazardRate))
    ).toFixed(2)
  );

  if (normHint) {
    normHint.textContent = hazardRate > 0
      ? `Норма месяца: ${monthNorm.toFixed(1)} ч • Оклад с вредностью +${(hazardRate * 100).toFixed(0)}%: ${formatRub(effectiveOklad, 0)}`
      : `Норма месяца: ${monthNorm.toFixed(1)} ч`;
  }

  const calc = computeSalary({
    oklad: effectiveOklad,
    normHours: monthNorm,
    workedHours,
    nightHours: totalNight,
  });

  if (!calc.ok) {
    setError(calc.error);
    currentPaySummary.calculated = null;
    currentPaySummary.status = computeCurrentPaySummaryStatus();
    renderMoneyUi(null);
    renderMonthStatusUi();
    renderActualHintUi();
    renderPayWarnings(null);
    return;
  }

  const r = calc.result;
  const baseHourRateGross = effectiveOklad / monthNorm;
  const bonusPerHourGross = (effectiveOklad * BONUS_RATE) / monthNorm;
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

  const fhDay = sumRange(dayHours, 0, Math.min(14, daysInMonth - 1));
  const fhNight = sumRange(nightHours, 0, Math.min(14, daysInMonth - 1));
  const fhTotal = fhDay + fhNight;
  const baseNetHourlyNoBonus = (effectiveOklad * (1 - TAX_RATE)) / monthNorm;
  const nightExtraNetHourly = (effectiveOklad / monthNorm) * NIGHT_EXTRA_RATE * (1 - TAX_RATE);
  const advanceApprox = baseNetHourlyNoBonus * fhTotal + nightExtraNetHourly * fhNight;

  calculated = cloneCalculatedSummary({
    net: netTotal,
    tax: taxTotal,
    gross: grossTotal,
    advance: advanceApprox,
    remaining: netTotal - advanceApprox,
    okladSnapshot: baseOklad,
    effectiveOkladSnapshot: effectiveOklad,
    hazardRate,
    monthNorm,
    personalNorm,
    workedHours,
    workedDayHours: totalDay,
    workedNightHours: totalNight,
    hourRateNet: r.hourRate,
    nightHourNet: r.hourRate + baseHourRateGross * NIGHT_EXTRA_RATE * (1 - TAX_RATE),
    baseFactGross: r.baseFact,
    bonusGross: r.bonus,
    nightExtraGross: r.nightExtra,
    holidayExtraGross,
  });

  currentPaySummary.calculated = calculated;
  currentPaySummary.status = computeCurrentPaySummaryStatus();

  renderMoneyUi(calculated);
  renderMonthStatusUi();
  renderActualHintUi();
  renderPayWarnings(calculated);
}

function currentPayload() {
  const sharedMarksMeta = personalSharedMarksChanged
    ? { sharedMarksSource: "personal" }
    : currentLoadedPayload?.sharedMarksSource
      ? {
          sharedMarksSource: currentLoadedPayload.sharedMarksSource,
          sharedMarksDepartmentKey: currentLoadedPayload.sharedMarksDepartmentKey ?? null,
        }
      : {};

  return {
    v: 5,
    year,
    month,
    ...sharedMarksMeta,
    isHoliday,
    isTransferredOff,
    isShortDay,
    dayHours,
    nightHours,
    leaveType,
    normSnapshot: createNormSnapshot(currentNormProfile(), BASE_DAY_HOURS),
    moneySnapshot: normalizeMoneySnapshot(currentMoneySnapshot),
    paySummary: {
      calculated: cloneCalculatedSummary(currentPaySummary.calculated),
      actual: cloneActualSummary(currentPaySummary.actual),
      status: computeCurrentPaySummaryStatus(),
    },
  };
}

async function doSaveTimesheet() {
  setSaveStatus("Сохраняю…", "busy");

  try {
    syncActualStateFromInputs();

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
  el.dataset.prev = "";
  el.disabled = true;
  el.classList.add("opacity-50","cursor-not-allowed");
  el.title = "Недоступно для заполнения";
}

function unlockNightCell(i) {
  const el = nightInputs?.[i];
  if (!el) return;
  el.disabled = false;
  el.classList.remove("opacity-50","cursor-not-allowed");
  el.title = "";
}

function lockDayCell(i) {
  const el = dayInputs?.[i];
  if (!el) return;
  el.disabled = true;
  el.classList.add("opacity-50","cursor-not-allowed");
  el.title = "После кода УВ дальнейшее заполнение заблокировано";
}

function unlockDayCell(i) {
  const el = dayInputs?.[i];
  if (!el) return;
  el.disabled = false;
  el.classList.remove("opacity-50","cursor-not-allowed");
  el.title = "";
}

function clearDismissalTail(startIndex) {
  for (let i = startIndex; i < daysInMonth; i++) {
    if (!isDismissedLeaveType(leaveType[i])) continue;
    leaveType[i] = null;
    dayHours[i] = 0;
    nightHours[i] = 0;
    if (dayInputs[i]) {
      dayInputs[i].value = "";
      dayInputs[i].dataset.prev = "";
    }
    if (nightInputs[i]) {
      nightInputs[i].value = "";
      nightInputs[i].dataset.prev = "";
    }
  }
}

function applyDismissalLock({ clearFuture = true } = {}) {
  const dismissalIndex = findDismissalIndex();

  for (let i = 0; i < daysInMonth; i++) {
    const isAfterDismissal = dismissedBeforeMonth || (dismissalIndex >= 0 && i > dismissalIndex);

    if (isAfterDismissal) {
      if (clearFuture) {
        dayHours[i] = 0;
        nightHours[i] = 0;
        leaveType[i] = DISMISSED_LEAVE_TYPE;
        if (dayInputs[i]) {
          dayInputs[i].value = "УВ";
          dayInputs[i].dataset.prev = "УВ";
        }
        if (nightInputs[i]) {
          nightInputs[i].value = "";
          nightInputs[i].dataset.prev = "";
        }
      }
      lockDayCell(i);
      lockNightCell(i);
      continue;
    }

    unlockDayCell(i);

    if (normalizeLeaveTypeLegacy(leaveType[i])) lockNightCell(i);
    else unlockNightCell(i);
  }
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
  isTransferredOff = new Array(daysInMonth).fill(false);
  isShortDay = new Array(daysInMonth).fill(false);
  dayHours = new Array(daysInMonth).fill(0);
  nightHours = new Array(daysInMonth).fill(0);
  leaveType = new Array(daysInMonth).fill(null);

  currentLoadedPayload = null;
  personalSharedMarksChanged = false;
  currentPaySummary = createEmptyPaySummary();
  currentMoneySnapshot = null;
  fillActualInputsFromState();
  syncActualNetInputUi();
  renderMonthStatusUi();
  renderActualHintUi();

  const emptyTh = document.createElement("th");
  emptyTh.classList.add("label-cell");
  headerRow.appendChild(emptyTh);

  for (let i = 1; i <= daysInMonth; i++) {
    const th = document.createElement("th");
    th.dataset.dayIndex = String(i - 1);

    const weekend = isWeekendByIndex(year, month, i - 1);
    if (weekend) th.classList.add("weekend-col");

    const dowIdx = new Date(year, month, i).getDay();
    const numEl = document.createElement("span");
    numEl.style.display = "block";
    numEl.textContent = String(i);

    const dowEl = document.createElement("span");
    dowEl.className = "th-dow";
    dowEl.textContent = DOW_SHORT[dowIdx];
    if (weekend) dowEl.style.color = "rgba(252, 165, 165, 0.7)";

    th.appendChild(numEl);
    th.appendChild(dowEl);

     th.style.cursor = "pointer";
    th.title = "1 клик — праздник. 2 клика — перенесённый выходной. 3 клика — сокращённый день.";

    let clickCount = 0;
    let clickTimer = null;

    th.addEventListener("click", (e) => {
      const idx = Number(e.currentTarget.dataset.dayIndex);
      clickCount += 1;

      if (clickTimer) clearTimeout(clickTimer);

      clickTimer = setTimeout(() => {
        if (clickCount === 1) {
          isHoliday[idx] = true;
          isTransferredOff[idx] = false;
          isShortDay[idx] = false;
        } else if (clickCount === 2) {
          isHoliday[idx] = false;
          isTransferredOff[idx] = true;
          isShortDay[idx] = false;
        } else if (clickCount >= 3) {
          isHoliday[idx] = false;
          isTransferredOff[idx] = false;
          isShortDay[idx] = true;
        }

        clickCount = 0;
        clickTimer = null;

        personalSharedMarksChanged = true;
        updateDayMarkClasses(idx);
        recalcAll();
        scheduleSave();
        updateMobileToolbar();
      }, 320);
    });

    th.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const idx = Number(e.currentTarget.dataset.dayIndex);
      isHoliday[idx] = false;
      isTransferredOff[idx] = false;
      isShortDay[idx] = false;
      personalSharedMarksChanged = true;
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
    dayInput.classList.add("input-hour","input-glass");
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
      if (String(dayInput.value ?? "").trim().toUpperCase() === "О") {
        dayInput.value = "ОТ";
        dayInput.dataset.prev = "ОТ";
      }
    });

    dayInput.addEventListener("input", () => {
      const sanitized = sanitizeDayCellValue(dayInput.value);
      if (sanitized !== dayInput.value) dayInput.value = sanitized;
      const raw = dayInput.value;
      const hadDismissalAtCell = isDismissedLeaveType(leaveType[i]);

      if (!raw.trim()) {
        setError(null);
        if (hadDismissalAtCell) {
          clearDismissalTail(i);
          applyDismissalLock({ clearFuture: false });
        }
        if (leaveType[i]) {
          leaveType[i] = null;
          unlockNightCell(i);
          applyDismissalLock({ clearFuture: false });
        }
        dayHours[i] = 0;
        dayInput.dataset.prev = "";
        recalcAll();
        scheduleSave();
        return;
      }

      const parsed = parseHoursOrLeave(raw);

      if (parsed.kind === "leave") {
        if (weekend && parsed.leave !== "vac_paid" && parsed.leave !== DISMISSED_LEAVE_TYPE) {
          setError("На выходные можно ставить только ОТ как календарную отметку отпуска.");
          revertToPrev(dayInput);
          return;
        }
        if (hadDismissalAtCell && parsed.leave !== DISMISSED_LEAVE_TYPE) {
          clearDismissalTail(i);
        }
        setError(null);
        leaveType[i] = parsed.leave;
        dayInput.value = sanitizeLeaveDisplayValue(raw, parsed.leave);
        dayHours[i] = 0;
        nightHours[i] = 0;
        lockNightCell(i);
        dayInput.dataset.prev = dayInput.value;
        applyDismissalLock({ clearFuture: true });
        recalcAll();
        scheduleSave();
        return;
      }

      if (parsed.kind === "hours") {
        setError(null);
        if (hadDismissalAtCell) {
          clearDismissalTail(i);
          applyDismissalLock({ clearFuture: false });
        }
        if (leaveType[i]) {
          leaveType[i] = null;
          unlockNightCell(i);
          applyDismissalLock({ clearFuture: false });
        }
        const nextDay = sanitizeHourNumber(parsed.hours);
        const nextNight = sanitizeHourNumber(nightHours[i] || 0);
        const ok = clampDayTotalOrRevert({ index: i, nextDay, nextNight, onRevert: () => revertToPrev(dayInput) });
        if (!ok) return;
        dayHours[i] = nextDay;
        dayInput.dataset.prev = dayInput.value;
        recalcAll();
        scheduleSave();
        return;
      }

      setError("Некорректное значение. Допустимы только числа или коды: ОТ, ОД, ОЗ, У, УД, Б, НТ, УВ.");
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
    nightInput.classList.add("input-hour","input-glass");
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
      if (s === "0" || s === "0.0" || s === "0,0") {
        nightInput.value = "";
        nightHours[i] = 0;
        scheduleSave();
        recalcAll();
      }
    });

    nightInput.addEventListener("input", () => {
      if (leaveType[i]) return;
      const sanitized = sanitizeNumericValue(nightInput.value);
      if (sanitized !== nightInput.value) nightInput.value = sanitized;
      const raw = nightInput.value;
      if (!raw.trim()) {
        setError(null);
        nightHours[i] = 0;
        nightInput.dataset.prev = "";
        recalcAll();
        scheduleSave();
        return;
      }
      const n = parseNumber(raw);
      if (!Number.isFinite(n)) {
        setError("Ночные: введите число или оставьте пусто.");
        return;
      }
      const nextNight = sanitizeHourNumber(n);
      const nextDay = sanitizeHourNumber(dayHours[i] || 0);
      const ok = clampDayTotalOrRevert({ index: i, nextDay, nextNight, onRevert: () => revertToPrev(nightInput) });
      if (!ok) return;
      setError(null);
      nightHours[i] = nextNight;
      nightInput.dataset.prev = nightInput.value;
      recalcAll();
      scheduleSave();
    });

    nightTd.appendChild(nightInput);
    nightRow.appendChild(nightTd);
    nightInputs.push(nightInput);
  }
}

function applyMonthMoneyContext(payload) {
  currentMoneySnapshot = resolveMoneySnapshotFromPayload(payload);

  if (currentMoneySnapshot?.okladSnapshot > 0) {
    if (okladInput) okladInput.value = formatMoneyForInput(currentMoneySnapshot.okladSnapshot);
    return;
  }

  const fallbackProfileOklad = Number(profileOklad);
  if (Number.isFinite(fallbackProfileOklad) && fallbackProfileOklad > 0) {
    currentMoneySnapshot = createMoneySnapshot(fallbackProfileOklad, "profile");
    if (okladInput) okladInput.value = formatMoneyForInput(fallbackProfileOklad);
    return;
  }

  currentMoneySnapshot = null;
  if (okladInput) okladInput.value = "";
}

function renderInputsFromState() {
  for (let i = 0; i < daysInMonth; i++) {
    updateDayMarkClasses(i);
    const dt = normalizeLeaveTypeLegacy(leaveType[i]);
    if (dt) dayInputs[i].value = leaveTypeToCode(dt, "ОТ");
    else dayInputs[i].value = formatHourForInput(dayHours[i]);

    if (leaveType[i]) lockNightCell(i);
    else {
      unlockNightCell(i);
      nightInputs[i].value = formatHourForInput(nightHours[i]);
    }

    dayInputs[i].dataset.prev = dayInputs[i].value ?? "";
    nightInputs[i].dataset.prev = nightInputs[i].value ?? "";
  }

  applyDismissalLock({ clearFuture: true });
}

function applyPayload(payload) {
  currentLoadedPayload = payload ?? null;
  personalSharedMarksChanged = false;
  applyNormContextFromPayload(payload);

  if (!payload || typeof payload !== "object") {
    currentPaySummary = createEmptyPaySummary();
    fillActualInputsFromState();
    applyMonthMoneyContext(null);
    applyEmploymentDateDefaults();
    renderInputsFromState();
    syncPaidLeaveControls();
    updateMobileToolbar();
    return;
  }

  if (Array.isArray(payload.isHoliday) && payload.isHoliday.length === daysInMonth) {
    isHoliday = payload.isHoliday;
  }
  if (Array.isArray(payload.isTransferredOff) && payload.isTransferredOff.length === daysInMonth) {
    isTransferredOff = payload.isTransferredOff;
  }
  if (Array.isArray(payload.isShortDay) && payload.isShortDay.length === daysInMonth) {
    isShortDay = payload.isShortDay;
  }
  if (Array.isArray(payload.dayHours) && payload.dayHours.length === daysInMonth) dayHours = payload.dayHours;
  if (Array.isArray(payload.nightHours) && payload.nightHours.length === daysInMonth) nightHours = payload.nightHours;
  if (Array.isArray(payload.leaveType) && payload.leaveType.length === daysInMonth) {
    leaveType = payload.leaveType.map((x) => normalizeLeaveTypeLegacy(x));
  }

  currentPaySummary = normalizeStoredPaySummary(payload.paySummary);
  applyMonthMoneyContext(payload);
  applyEmploymentDateDefaults();

  renderInputsFromState();

  fillActualInputsFromState();
  syncActualNetInputUi();
  syncPaidLeaveControls();
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
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth();
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

function syncOkladActionState() {
  if (!useProfileOkladBtn) return;
  const canUse = Number.isFinite(Number(profileOklad)) && Number(profileOklad) > 0;
  useProfileOkladBtn.disabled = !canUse;
  useProfileOkladBtn.classList.toggle("opacity-60", !canUse);
  useProfileOkladBtn.classList.toggle("cursor-not-allowed", !canUse);
}

async function loadCurrentMonthFromDb() {
  setSaveStatus("Загружаю…", "busy");
  try {
    const [payload] = await Promise.all([
      loadTimesheet(year, month),
      refreshDismissalBeforeMonth(),
    ]);
    applyPayload(payload);

    if (payload) {
      recalcAll();
      lastSavedJSON = JSON.stringify(currentPayload());
      dirty = false;
      setSaveStatus("Сохранено", "ok");
    } else {
      recalcAll();
      lastSavedJSON = JSON.stringify(currentPayload());
      dirty = false;
      setSaveStatus("Новый табель", "neutral");
    }
  } catch (e) {
    setSaveStatus("Ошибка загрузки", "err");
    setError(e?.message || "Не удалось загрузить табель.");
  }
}

function isMobileNow() {
  return window.matchMedia?.("(max-width: 767px)")?.matches ?? (window.innerWidth < 768);
}

function scrollTableToColumn(idx) {
  if (!tableScrollable) return;
  const th = headerCells[idx];
  if (!th) return;
  const containerWidth = tableScrollable.clientWidth;
  const thLeft = th.offsetLeft;
  const thWidth = th.offsetWidth;
  const labelWidth = 46;
  const targetScrollLeft = thLeft - labelWidth - (containerWidth - labelWidth) / 2 + thWidth / 2;
  tableScrollable.scrollTo({
    left: Math.max(0, targetScrollLeft),
    behavior: prefersReducedMotion ? "auto" : "smooth",
  });
}

function updateMobileToolbar() {
  if (!isMobileNow()) return;
  const idx = mobileSelectedIdx;
  if (!Number.isInteger(idx) || idx < 0 || idx >= daysInMonth) return;

  const d = new Date(year, month, idx + 1);
  if (mDayLabel) mDayLabel.textContent = `${idx + 1} · ${DOW_SHORT[d.getDay()]}`;
  if (mHolidayBtn) mHolidayBtn.classList.toggle("is-active", Boolean(isHoliday[idx]));
  if (mTransferredBtn) mTransferredBtn.classList.toggle("is-active", Boolean(isTransferredOff[idx]));
  if (mShortBtn) mShortBtn.classList.toggle("is-active", Boolean(isShortDay[idx]));
}

function setMobileDay(idx) {
  if (idx < 0) idx = 0;
  if (idx >= daysInMonth) idx = daysInMonth - 1;
  mobileSelectedIdx = idx;
  focusDayColumn(idx);
  scrollTableToColumn(idx);
  updateMobileToolbar();
}

mPrevDayBtn?.addEventListener("click", () => setMobileDay(mobileSelectedIdx - 1));
mNextDayBtn?.addEventListener("click", () => setMobileDay(mobileSelectedIdx + 1));
mTodayBtn?.addEventListener("click", () => {
  const now = new Date();
  if (now.getFullYear() === year && now.getMonth() === month) setMobileDay(now.getDate() - 1);
});
mHolidayBtn?.addEventListener("click", () => {
  const idx = mobileSelectedIdx;
  if (!Number.isInteger(idx)) return;

  const next = !isHoliday[idx];
  isHoliday[idx] = next;
  isTransferredOff[idx] = false;
  isShortDay[idx] = false;

  if (!next) {
    isHoliday[idx] = false;
  }

  personalSharedMarksChanged = true;
  updateDayMarkClasses(idx);
  recalcAll();
  scheduleSave();
  updateMobileToolbar();
});

mTransferredBtn?.addEventListener("click", () => {
  const idx = mobileSelectedIdx;
  if (!Number.isInteger(idx)) return;

  const next = !isTransferredOff[idx];
  isHoliday[idx] = false;
  isTransferredOff[idx] = next;
  isShortDay[idx] = false;

  if (!next) {
    isTransferredOff[idx] = false;
  }

  personalSharedMarksChanged = true;
  updateDayMarkClasses(idx);
  recalcAll();
  scheduleSave();
  updateMobileToolbar();
});

mShortBtn?.addEventListener("click", () => {
  const idx = mobileSelectedIdx;
  if (!Number.isInteger(idx)) return;

  const next = !isShortDay[idx];
  isHoliday[idx] = false;
  isTransferredOff[idx] = false;
  isShortDay[idx] = next;

  if (!next) {
    isShortDay[idx] = false;
  }

  personalSharedMarksChanged = true;
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
    el.classList.remove("holiday-col", "transferred-col", "short-col");

    if (isHoliday[index]) el.classList.add("holiday-col");
    else if (isTransferredOff[index]) el.classList.add("transferred-col");
    else if (isShortDay[index]) el.classList.add("short-col");
  }
}

logoutBtn?.addEventListener("click", async () => {
  try { await signOut(); } finally { location.href = "login.html?next=table.html"; }
});

saveBtn?.addEventListener("click", async () => { await doSaveTimesheet(); });

okladInput?.addEventListener("input", () => {
  const raw = String(okladInput.value ?? "").trim();
  const parsed = parseNumber(raw);

  if (!raw) {
    currentMoneySnapshot = null;
  } else if (Number.isFinite(parsed) && parsed > 0) {
    currentMoneySnapshot = createMoneySnapshot(parsed, "manual");
  } else {
    currentMoneySnapshot = null;
  }

  recalcAll();
  scheduleSave();
});

useProfileOkladBtn?.addEventListener("click", () => {
  const nextOklad = Number(profileOklad);
  if (!(Number.isFinite(nextOklad) && nextOklad > 0)) {
    setError("В профиле пока не указан оклад.");
    return;
  }

  currentMoneySnapshot = createMoneySnapshot(nextOklad, "profile");
  if (okladInput) okladInput.value = formatMoneyForInput(nextOklad);

  setError(null);
  recalcAll();
  scheduleSave();
});

monthSelect?.addEventListener("change", async () => {
  month = Number(monthSelect.value);
  updateUrlForMonth();
  buildTableForMonth();
  await loadCurrentMonthFromDb();
  if (isMobileNow()) setMobileDay(mobileSelectedIdx < daysInMonth ? mobileSelectedIdx : 0);
});

yearSelect?.addEventListener("change", async () => {
  year = Number(yearSelect.value);
  updateUrlForMonth();
  buildTableForMonth();
  await loadCurrentMonthFromDb();
  if (isMobileNow()) setMobileDay(mobileSelectedIdx < daysInMonth ? mobileSelectedIdx : 0);
});

setupTableMoneyControls();
setupActualMoneyControls();

(async () => {
  try {
    await requireSession();
  } catch {
    location.href = "login.html?next=table.html";
    return;
  }

  startPresenceHeartbeat("Личный табель");

  let profile = null;

  try {
    profile = await getMyProfile();

    moneyProfile = profile ?? null;
    ensureTableMoneyAccess = createMoneyAccessGuard(profile, {
      title: "Показать выплаты",
      description: "Введите 4-значный PIN-код, чтобы показать оклад и расчёт выплат.",
      confirmText: "Показать",
    });
  } catch (e) {
    setSaveStatus("Ошибка профиля", "err");
    setError(e?.message || "Не удалось загрузить профиль.");
    return;
  }

  const missingProfileFields = getMissingRequiredProfileFields(profile);
if (missingProfileFields.length) {
  renderProfileCompletionGate(profile);
  return;
}

setFromQueryOrNow();
fillYearOptions();
updateUrlForMonth();
buildTableForMonth();
applyAutoCollapsedPanels(profile);

  profileRole = profile?.role ?? "user";
  profileOklad = profile?.oklad ?? null;
  profilePosition = profile?.position ?? "";
  profileGender = profile?.gender ?? null;
  profileBranch = profile?.branch ?? null;
  profileWeeklyHours = profile?.weekly_hours ?? null;
  profileEmploymentDate = profile?.employment_date ?? null;

  const managedDepartment = await getMyManagedDepartment().catch(() => null);

  if (managedDepartment) {
  adminLink?.classList.remove("hidden");
  if (adminLink) {
    adminLink.href = `admin.html?department=${encodeURIComponent(managedDepartment.key)}`;
    adminLink.textContent = managedDepartment.name
      ? `Табель: ${managedDepartment.name}`
      : "Табель отдела";
  }
} else {
  adminLink?.classList.add("hidden");
}

  const moneyProtected = isMoneyProtectionEnabled(profile);
  okladVisible = !moneyProtected;
  payVisible = !moneyProtected;
  syncTableMoneyUi();
  syncOkladActionState();

  BASE_DAY_HOURS = getBaseDayHoursByProfile(currentNormProfile());
  LEAVE_HOURS_PER_DAY = BASE_DAY_HOURS;


  await loadCurrentMonthFromDb();
  startPaymentCountdownTimer();

  if (isMobileNow()) {
    const now = new Date();
    const initIdx = (now.getFullYear() === year && now.getMonth() === month)
      ? now.getDate() - 1
      : 0;
    setMobileDay(Math.min(initIdx, daysInMonth - 1));
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


