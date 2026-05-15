// =========================
// FILE: /profile.js
// =========================
import { requireSession, signOut } from "./auth.js";
import {
  getMyProfile,
  updateMyProfile,
  listMyTimesheetsByYear,
  deleteMyTimesheet,
} from "./db.js";
import { startPresenceHeartbeat } from "./presence.js";
import {
  parseNumber,
  BONUS_RATE,
  TAX_RATE,
  NIGHT_EXTRA_RATE,
  computeSalary,
} from "./calc.js";
import { supabase } from "./supabaseClient.js";

import {
  getMissingRequiredProfileFields,
  getMissingRequiredProfileLabels,
  isProfileCompleteForTimesheet,
  normalizeInternalNextUrl,
} from "./profileCompletion.js";

import {
  createMoneyAccessGuard,
  EYE_ICON,
  EYE_OFF_ICON,
  isMoneyProtectionEnabled,
  setRevealButtonState,
} from "./moneyPrivacy.js";
import { confirmDialog } from "./modal.js";

document.body.classList.add("is-loaded");

const OVERTIME_LIMIT_YEAR = 120;
const SHORT_DAY_REDUCTION_HOURS = 1;
const HAZARD_POSITION_RATE = 0.04;
const CHATEAU_ALVISA_BRANCH = "chateau_alvisa";
const NOT_EMPLOYED_LEAVE_TYPE = "not_employed";

const DEFAULT_DAY_HOURS = 8;
const FEMALE_DAY_HOURS = 7.2;
let BASE_DAY_HOURS = DEFAULT_DAY_HOURS;

let currentProfile = null;

const logoutBtn = document.getElementById("logoutBtn");
const ownerLink = document.getElementById("ownerLink");

const statusPill = document.getElementById("statusPill");
const errorBox = document.getElementById("errorBox");

const avatarImg = document.getElementById("avatarImg");
const avatarFallback = document.getElementById("avatarFallback");
const displayNameEl = document.getElementById("displayName");
const emailHint = document.getElementById("emailHint");

const displayNameInput = document.getElementById("displayNameInput");
const positionSelect = document.getElementById("positionSelect");
const okladInput = document.getElementById("okladInput");
const genderSelect = document.getElementById("genderSelect");
const tabNumberInput = document.getElementById("tabNumberInput");
const branchSelect = document.getElementById("branchSelect");
const employmentDateInput = document.getElementById("employmentDateInput");
const okladPeekBtnInitial = document.getElementById("okladInputPeekBtn");
const saveProfileBtn = document.getElementById("saveProfileBtn");
const refreshBtn = document.getElementById("refreshBtn");

const yearSelect = document.getElementById("yearSelect");
const overtimeYearEl = document.getElementById("overtimeYear");
const overtimeRemainingEl = document.getElementById("overtimeRemaining");
const overtimeAdjustmentEl = document.getElementById("overtimeAdjustment");
const yearNetIncomeEl = document.getElementById("yearNetIncome");
const yearTaxPaidEl = document.getElementById("yearTaxPaid");
const timesheetsList = document.getElementById("timesheetsList");

const overtimeBarFill = document.getElementById("overtimeBarFill");
const overtimeBarText = document.getElementById("overtimeBarText");

/* Calendar DOM */
const calMonthLabel = document.getElementById("calMonthLabel");
const calDowRow = document.getElementById("calDowRow");
const calGrid = document.getElementById("calGrid");
const calPrevBtn = document.getElementById("calPrevBtn");
const calNextBtn = document.getElementById("calNextBtn");
const calTodayBtn = document.getElementById("calTodayBtn");

/* Avatar DOM */
const avatarFileInput = document.getElementById("avatarFileInput");
const avatarUploadBtn = document.getElementById("avatarUploadBtn");
const avatarRemoveBtn = document.getElementById("avatarRemoveBtn");
const avatarHint = document.getElementById("avatarHint");

const displayNameLabel = document.querySelector('label[for="displayNameInput"]');
const positionLabel = document.querySelector('label[for="positionSelect"]');
const genderLabel = document.querySelector('label[for="genderSelect"]');
const tabNumberLabel = document.querySelector('label[for="tabNumberInput"]');
const okladLabel = document.querySelector('label[for="okladInput"]');

const profileRequiredNotice = document.getElementById("profileRequiredNotice");
const profileRequiredNoticeTitle = document.getElementById("profileRequiredNoticeTitle");
const profileRequiredNoticeText = document.getElementById("profileRequiredNoticeText");
const profileRequiredNoticeBackLink = document.getElementById("profileRequiredNoticeBackLink");

const PROFILE_AUTOFILL_ATTRS = {
  autocomplete: "off",
  autocorrect: "off",
  autocapitalize: "off",
  spellcheck: "false",
  "data-lpignore": "true",
  "data-1p-ignore": "true",
  "data-form-type": "other",
};

const pageParams = new URLSearchParams(window.location.search);
const mustCompleteProfile = pageParams.get("completeProfile") === "1";
const nextAfterProfile = normalizeInternalNextUrl(pageParams.get("next"), "table.html");

/* ===== Avatar upload settings ===== */
const AVATAR_BUCKET = "avatars";
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const monthNamesShort = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
const monthNamesFull = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const WEEK_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const POSITION_VALUES = new Set([
  "",
  "egais_head",
  "egais_senior_operator",
  "egais_operator",
  "warehouse_head",
  "storekeeper",
  "loader",
  "driver",
  "bottling_plant_head",
  "shift_senior_master",
  "shift_master",
  "filling_line_operator",
  "accountant",
  "laboratory_head",
  "deputy_head_laboratory",
  "entrance_control_engineer",
  "quality_control_engineer",
  "chemist",
  "microbiologist",
]);

const BRANCH_VALUES = new Set([
  "",
  "chateau_alvisa",
  "alvisa_whisky",
  "alvisa_beverage",
  "alvisa_whisky_distillery",
  "kin_wine_cognac_factory",
]);

let loadedYear = new Date().getFullYear();
let payloadByMonth = new Map();

let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();

let ensureProfileMoneyAccess = async () => true;
let okladVisible = true;
let yearMoneyVisible = true;
let yearNetIncomeText = "—";
let yearTaxPaidText = "—";
let okladPeekBtn = null;
let profileYearPeekBtn = null;
let profileFieldsTouched = false;

function getProfileAutofillFields() {
  return [
    displayNameInput,
    positionSelect,
    genderSelect,
    tabNumberInput,
    branchSelect,
    employmentDateInput,
    okladInput,
  ].filter(Boolean);
}

function hardenProfileAutofill() {
  for (const field of getProfileAutofillFields()) {
    for (const [key, value] of Object.entries(PROFILE_AUTOFILL_ATTRS)) {
      field.setAttribute(key, value);
    }
  }

  if (okladInput) {
    okladInput.type = "text";
  }
}

function getExpectedProfileFieldValues(profile) {
  return {
    displayName: profile?.display_name ?? "",
    position: profile?.position ?? "",
    gender: profile?.gender ?? "",
    tabNumber: profile?.tab_number ?? "",
    branch: profile?.branch ?? "",
    employmentDate: profile?.employment_date ?? "",
    oklad: profile?.oklad != null ? String(profile.oklad) : "",
  };
}

function applyExpectedProfileFieldValues(values) {
  if (displayNameInput) displayNameInput.value = values.displayName;
  if (positionSelect) positionSelect.value = values.position;
  if (genderSelect) genderSelect.value = values.gender;
  if (tabNumberInput) tabNumberInput.value = values.tabNumber;
  if (branchSelect) branchSelect.value = values.branch;
  if (employmentDateInput) {
    employmentDateInput.value = values.employmentDate;
    updateEmploymentDateHint();
  }
  if (okladInput) okladInput.value = values.oklad;
}

function pluralRu(value, one, few, many) {
  const n = Math.abs(Number(value)) % 100;
  const n1 = n % 10;

  if (n > 10 && n < 20) return many;
  if (n1 > 1 && n1 < 5) return few;
  if (n1 === 1) return one;
  return many;
}

function formatEmploymentDuration({ years, months, days }) {
  const parts = [];

  if (years > 0) parts.push(`${years} ${pluralRu(years, "год", "года", "лет")}`);
  if (months > 0) parts.push(`${months} ${pluralRu(months, "месяц", "месяца", "месяцев")}`);
  if (days > 0 || !parts.length) parts.push(`${days} ${pluralRu(days, "день", "дня", "дней")}`);

  return parts.join(", ");
}

function parseProfileDate(value) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const y = Number(match[1]);
  const m = Number(match[2]) - 1;
  const d = Number(match[3]);
  const date = new Date(y, m, d);

  if (date.getFullYear() !== y || date.getMonth() !== m || date.getDate() !== d) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getDaysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function addYearsClamped(date, years) {
  const year = date.getFullYear() + years;
  const month = date.getMonth();
  const day = Math.min(date.getDate(), getDaysInMonth(year, month));
  return new Date(year, month, day);
}

function addMonthsClamped(date, months) {
  const totalMonth = date.getMonth() + months;
  const year = date.getFullYear() + Math.floor(totalMonth / 12);
  const month = ((totalMonth % 12) + 12) % 12;
  const day = Math.min(date.getDate(), getDaysInMonth(year, month));
  return new Date(year, month, day);
}

function diffCalendarInclusive(startDate, endDate) {
  const endExclusive = addDays(endDate, 1);

  let years = endExclusive.getFullYear() - startDate.getFullYear();
  let anchor = addYearsClamped(startDate, years);

  if (anchor > endExclusive) {
    years -= 1;
    anchor = addYearsClamped(startDate, years);
  }

  let months = endExclusive.getMonth() - anchor.getMonth() +
    (endExclusive.getFullYear() - anchor.getFullYear()) * 12;
  let monthAnchor = addMonthsClamped(anchor, months);

  if (monthAnchor > endExclusive) {
    months -= 1;
    monthAnchor = addMonthsClamped(anchor, months);
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  const days = Math.max(0, Math.round((endExclusive - monthAnchor) / msPerDay));

  return { years, months, days };
}

function updateEmploymentDateHint() {
  if (!employmentDateInput) return;

  const startDate = parseProfileDate(employmentDateInput.value);
  if (!startDate) {
    employmentDateInput.title = "Выберите дату трудоустройства, чтобы увидеть стаж в АЛВИСА.";
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (startDate > today) {
    employmentDateInput.title = "Дата трудоустройства еще не наступила.";
    return;
  }

  const duration = diffCalendarInclusive(startDate, today);
  employmentDateInput.title = `Вы работаете в АЛВИСА уже ${formatEmploymentDuration(duration)}.`;
}

function guardProfileFieldsAgainstLateAutofill(profile) {
  const expected = getExpectedProfileFieldValues(profile);
  const restore = () => {
    if (profileFieldsTouched) return;
    applyExpectedProfileFieldValues(expected);
  };

  requestAnimationFrame(restore);
  window.setTimeout(restore, 80);
  window.setTimeout(restore, 300);
  window.setTimeout(restore, 900);
}

function markProfileFieldsTouched() {
  profileFieldsTouched = true;
}

function markProfileTextInputTouched(event) {
  if (event?.inputType === "insertReplacementText") return;
  markProfileFieldsTouched();
}

function replaceElementWithClone(el) {
  if (!el) return null;
  const clone = el.cloneNode(true);
  el.replaceWith(clone);
  return clone;
}

function ensureProfileYearPeekButton() {
  const card = yearNetIncomeEl?.closest(".glass-card");
  if (!card) return null;

  let btn = card.querySelector("#profileYearPeekBtn");
  if (btn) return btn;

  card.classList.add("relative");

  btn = document.createElement("button");
  btn.id = "profileYearPeekBtn";
  btn.type = "button";
  btn.className =
    "absolute right-4 top-4 inline-flex items-center gap-2 rounded-2xl bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 ring-1 ring-white/10 hover:bg-white/10";
  btn.innerHTML = `${EYE_ICON}<span>Показать</span>`;

  card.appendChild(btn);
  return btn;
}

function applyProfileOkladVisibility() {
  if (!okladInput) return;
  okladInput.type = "text";
  okladInput.classList.toggle("profile-money-masked", !okladVisible);

  if (!okladPeekBtn) return;
  okladPeekBtn.innerHTML = okladVisible ? EYE_OFF_ICON : EYE_ICON;
  okladPeekBtn.setAttribute("aria-label", okladVisible ? "Скрыть оклад" : "Показать оклад");
}

function applyProfileYearVisibility() {
  if (yearNetIncomeEl) {
    yearNetIncomeEl.textContent = yearMoneyVisible ? yearNetIncomeText : "••••••";
  }
  if (yearTaxPaidEl) {
    yearTaxPaidEl.textContent = yearMoneyVisible ? yearTaxPaidText : "••••••";
  }

  if (!profileYearPeekBtn) return;

  const textEl = profileYearPeekBtn.querySelector("span");
  setRevealButtonState({
    hidden: !yearMoneyVisible,
    button: profileYearPeekBtn,
    textEl,
    iconEl: profileYearPeekBtn,
    showText: "Показать",
    hideText: "Скрыть",
    showAria: "Показать итоги за год",
    hideAria: "Скрыть итоги за год",
  });

  profileYearPeekBtn.innerHTML = `${yearMoneyVisible ? EYE_OFF_ICON : EYE_ICON}<span>${yearMoneyVisible ? "Скрыть" : "Показать"}</span>`;
}

function syncProfileMoneyUi() {
  const protectedMoney = isMoneyProtectionEnabled(currentProfile);

  if (!protectedMoney) {
    okladVisible = true;
    yearMoneyVisible = true;
  }

  applyProfileOkladVisibility();
  applyProfileYearVisibility();
}

function setupProfileMoneyControls() {
  okladPeekBtn = replaceElementWithClone(okladPeekBtnInitial);
  profileYearPeekBtn = ensureProfileYearPeekButton();

  okladPeekBtn?.addEventListener("click", async (e) => {
    e.preventDefault();

    if (!okladVisible && isMoneyProtectionEnabled(currentProfile)) {
      const ok = await ensureProfileMoneyAccess();
      if (!ok) return;
    }

    okladVisible = !okladVisible;
    applyProfileOkladVisibility();
  });

  profileYearPeekBtn?.addEventListener("click", async () => {
    if (!yearMoneyVisible && isMoneyProtectionEnabled(currentProfile)) {
      const ok = await ensureProfileMoneyAccess();
      if (!ok) return;
    }

    yearMoneyVisible = !yearMoneyVisible;
    applyProfileYearVisibility();
  });

  syncProfileMoneyUi();
}

function requireDom(el, name) {
  if (el) return true;
  setError(`Ошибка верстки профиля: не найден элемент "${name}". Проверь id в profile.html`);
  setStatus("Ошибка верстки", "err");
  return false;
}

function setStatus(text, tone = "neutral") {
  if (!statusPill) return;
  statusPill.textContent = text;

  statusPill.classList.remove(
    "text-slate-300", "bg-white/5",
    "text-emerald-200", "bg-emerald-500/10",
    "text-rose-200", "bg-rose-500/10",
    "text-sky-200", "bg-sky-500/10"
  );

  if (tone === "ok") statusPill.classList.add("text-emerald-200", "bg-emerald-500/10");
  else if (tone === "err") statusPill.classList.add("text-rose-200", "bg-rose-500/10");
  else if (tone === "busy") statusPill.classList.add("text-sky-200", "bg-sky-500/10");
  else statusPill.classList.add("text-slate-300", "bg-white/5");
}

function setError(msg) {
  if (!errorBox) return;
  if (!msg) {
    errorBox.classList.add("hidden");
    errorBox.textContent = "";
    errorBox.classList.remove("shake");
    return;
  }
  errorBox.classList.remove("hidden");
  errorBox.textContent = msg;
  errorBox.classList.remove("shake");
  errorBox.offsetWidth;
  errorBox.classList.add("shake");
}

function isWeekendByIndex(y, m, dayIndex0) {
  const d = new Date(y, m, dayIndex0 + 1).getDay();
  return d === 0 || d === 6;
}

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function sum(arr) {
  if (!Array.isArray(arr)) return 0;
  return arr.reduce((a, b) => a + (Number.isFinite(Number(b)) ? Number(b) : 0), 0);
}

function normalizeLeaveTypeLegacy(lt) {
  if (!lt) return null;
  if (lt === "vacation") return "vac_paid";
  if (lt === "sick") return "sick";
  if (lt === NOT_EMPLOYED_LEAVE_TYPE) return NOT_EMPLOYED_LEAVE_TYPE;
  if (String(lt).trim().toUpperCase() === "НТ") return NOT_EMPLOYED_LEAVE_TYPE;
  return String(lt);
}

function leaveTypeToCode(lt) {
  const t = normalizeLeaveTypeLegacy(lt);
  if (!t) return "";
  if (t === "vac_paid") return "ОТ";
  if (t === "vac_unpaid") return "ОД";
  if (t === "vac_unpaid_required") return "ОЗ";
  if (t === "edu_paid") return "У";
  if (t === "edu_unpaid") return "УД";
  if (t === "sick") return "Б";
  if (t === NOT_EMPLOYED_LEAVE_TYPE) return "НТ";
  return "";
}

function leaveTypeToLabel(lt) {
  const t = normalizeLeaveTypeLegacy(lt);
  if (!t) return "";
  if (t === "vac_paid") return "Отпуск (ОТ)";
  if (t === "vac_unpaid") return "Отпуск без оплаты (ОД)";
  if (t === "vac_unpaid_required") return "Отпуск без оплаты (ОЗ)";
  if (t === "edu_paid") return "Учебный отпуск (У)";
  if (t === "edu_unpaid") return "Учебный отпуск без оплаты (УД)";
  if (t === "sick") return "Больничный (Б)";
  if (t === NOT_EMPLOYED_LEAVE_TYPE) return "Не трудоустроен (НТ)";
  return String(t);
}

function formatHoursSigned(h) {
  const n = Number(h);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n).toFixed(1);
  if (n > 0.0001) return `+${abs} ч`;
  if (n < -0.0001) return `−${abs} ч`;
  return "0.0 ч";
}

function formatHoursPlain(h) {
  const n = Number(h);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(1)} ч`;
}

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ₽`;
}

function normalizeMoneyNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function getBaseDayHoursByProfile(profile) {
  return profile?.gender === "female" && profile?.branch === CHATEAU_ALVISA_BRANCH
    ? FEMALE_DAY_HOURS
    : DEFAULT_DAY_HOURS;
}

function getHazardRateByPosition(position) {
  const p = String(position ?? "").trim().toLowerCase();
  if (p === "loader" || p === "грузчик") return HAZARD_POSITION_RATE;
  return 0;
}

function normalizeMoneySnapshot(raw) {
  if (!raw || typeof raw !== "object") return null;

  const okladSnapshot = Number(raw.okladSnapshot);
  if (!(Number.isFinite(okladSnapshot) && okladSnapshot > 0)) return null;

  const hazardRateSnapshot = Number.isFinite(Number(raw.hazardRateSnapshot))
    ? Number(Number(raw.hazardRateSnapshot).toFixed(4))
    : Number.isFinite(Number(raw.hazardRate))
      ? Number(Number(raw.hazardRate).toFixed(4))
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
  };
}

function resolveMoneySnapshotFromPayload(payload, profile) {
  const direct = normalizeMoneySnapshot(payload?.moneySnapshot);
  if (direct) return direct;

  const calc = payload?.paySummary?.calculated;
  const fromNewCalculated = normalizeMoneySnapshot({
    okladSnapshot: calc?.okladSnapshot,
    hazardRateSnapshot: calc?.hazardRate,
    effectiveOkladSnapshot: calc?.effectiveOkladSnapshot,
  });
  if (fromNewCalculated) return fromNewCalculated;

  const legacyFlat = payload?.paySummary;
  const fromLegacyFlat = normalizeMoneySnapshot({
    okladSnapshot: legacyFlat?.okladSnapshot,
    hazardRateSnapshot: legacyFlat?.hazardRate,
    effectiveOkladSnapshot: legacyFlat?.effectiveOkladSnapshot,
  });
  if (fromLegacyFlat) return fromLegacyFlat;

  const profileOklad = Number(profile?.oklad);
  if (Number.isFinite(profileOklad) && profileOklad > 0) {
    const hazardRateSnapshot = getHazardRateByPosition(profile?.position);
    return {
      okladSnapshot: Number(profileOklad.toFixed(2)),
      hazardRateSnapshot: Number(hazardRateSnapshot.toFixed(4)),
      effectiveOkladSnapshot: Number((profileOklad * (1 + hazardRateSnapshot)).toFixed(2)),
    };
  }

  return null;
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
  };
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

function normalizeStoredPaySummary(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      calculated: null,
      actual: createEmptyActualSummary(),
      status: "draft",
    };
  }

  if ("calculated" in raw || "actual" in raw || "status" in raw) {
    return {
      calculated: cloneCalculatedSummary(raw.calculated),
      actual: cloneActualSummary(raw.actual),
      status: typeof raw.status === "string" ? raw.status : "draft",
    };
  }

  return {
    calculated: cloneCalculatedSummary({
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
    }),
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
  ].some((x) => Number.isFinite(Number(x)));
}

function hasConfirmedActual(actual) {
  return Boolean(actual?.confirmedAt) && hasAnyActualValues(actual);
}

function getTimesheetMoneyState(payload) {
  const paySummary = normalizeStoredPaySummary(payload?.paySummary);
  const actual = paySummary.actual;
  const calculated = paySummary.calculated;
  const confirmed = hasConfirmedActual(actual);

  return {
    paySummary,
    actual,
    calculated,
    confirmed,
    status:
      confirmed
        ? (typeof paySummary.status === "string" ? paySummary.status : "actual_confirmed")
        : (typeof paySummary.status === "string" ? paySummary.status : "draft"),
  };
}

function getTimesheetActualSummaryLabel(payload) {
  const money = getTimesheetMoneyState(payload);

  if (!hasAnyActualValues(money.actual)) return null;
  if (!money.confirmed) {
    return { text: "Черновик факта", tone: "neutral" };
  }
  if (money.status === "changed_after_confirm") {
    return { text: "Факт + изменения", tone: "warn" };
  }
  return { text: "Факт подтверждён", tone: "ok" };
}

function setRequiredLabelState(labelEl, required) {
  if (!labelEl) return;
  if (!labelEl.dataset.baseText) {
    labelEl.dataset.baseText = labelEl.textContent.trim();
  }

  labelEl.textContent = required
    ? `${labelEl.dataset.baseText} — обязательно`
    : labelEl.dataset.baseText;

  labelEl.classList.toggle("text-rose-200", required);
}

function clearFieldHighlightStyles(fieldEl) {
  if (!fieldEl) return;
  fieldEl.classList.remove("required-missing-field");
  fieldEl.style.borderColor = "";
  fieldEl.style.boxShadow = "";
  fieldEl.style.background = "";
}

function applyFieldHighlightStyles(fieldEl) {
  if (!fieldEl) return;
  fieldEl.classList.add("required-missing-field");
  fieldEl.style.borderColor = "rgba(251, 113, 133, 0.70)";
  fieldEl.style.boxShadow =
    "0 0 0 2px rgba(251, 113, 133, 0.22), 0 10px 30px -20px rgba(251, 113, 133, 0.45)";
  fieldEl.style.background = "rgba(190, 24, 93, 0.08)";
}

function clearRequiredFieldHighlights() {
  const items = [
    [displayNameInput, displayNameLabel],
    [positionSelect, positionLabel],
    [genderSelect, genderLabel],
    [okladInput, okladLabel],
  ];

  for (const [fieldEl, labelEl] of items) {
    clearFieldHighlightStyles(fieldEl);
    setRequiredLabelState(labelEl, false);
  }
}

function applyRequiredFieldHighlights(profile) {
  clearRequiredFieldHighlights();

  const missing = new Set(getMissingRequiredProfileFields(profile));
  const config = {
    display_name: [displayNameInput, displayNameLabel],
    position: [positionSelect, positionLabel],
    gender: [genderSelect, genderLabel],
    oklad: [okladInput, okladLabel],
  };

  for (const [key, [fieldEl, labelEl]] of Object.entries(config)) {
    const required = missing.has(key);
    setRequiredLabelState(labelEl, required);

    if (required) {
      applyFieldHighlightStyles(fieldEl);
    }
  }

  return [...missing];
}

function renderProfileRequiredNotice(profile) {
  const missingLabels = getMissingRequiredProfileLabels(profile);

  if (!profileRequiredNotice || !profileRequiredNoticeTitle || !profileRequiredNoticeText) {
    return missingLabels;
  }

  profileRequiredNotice.classList.remove(
    "hidden",
    "notice-warning",
    "notice-success"
  );

  if (!missingLabels.length) {
    if (!mustCompleteProfile) {
      profileRequiredNotice.classList.add("hidden");
      profileRequiredNoticeBackLink?.classList.add("hidden");
      return missingLabels;
    }

    profileRequiredNotice.classList.add("notice-success");
    profileRequiredNoticeTitle.textContent = "Профиль заполнен";
    profileRequiredNoticeText.textContent = "Все обязательные поля заполнены. Теперь можно вернуться в табель.";

    if (profileRequiredNoticeBackLink) {
      profileRequiredNoticeBackLink.href = nextAfterProfile;
      profileRequiredNoticeBackLink.textContent = "Вернуться в табель";
      profileRequiredNoticeBackLink.classList.remove("hidden");
    }

    return missingLabels;
  }

  profileRequiredNotice.classList.add("notice-warning");
  profileRequiredNoticeTitle.textContent = mustCompleteProfile
    ? "Табель недоступен, пока профиль не заполнен"
    : "Профиль заполнен не полностью";
  profileRequiredNoticeText.textContent = mustCompleteProfile
    ? `Чтобы открыть табель, заполните и сохраните обязательные поля: ${missingLabels.join(", ")}.`
    : `Для корректной работы табеля заполните обязательные поля: ${missingLabels.join(", ")}.`;

  profileRequiredNoticeBackLink?.classList.add("hidden");
  return missingLabels;
}

function focusFirstMissingRequiredField(profile) {
  const missing = getMissingRequiredProfileFields(profile);
  if (!missing.length) return;

  const fieldMap = {
    display_name: displayNameInput,
    position: positionSelect,
    gender: genderSelect,
    oklad: okladInput,
  };

  const target = fieldMap[missing[0]];
  if (!target) return;

  requestAnimationFrame(() => {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.focus();
    if (typeof target.select === "function" && target.tagName === "INPUT") {
      target.select();
    }
  });
}

function computeCalendarNormFromPayload(payload, baseDayHours) {
  if (!payload || typeof payload !== "object") return 0;

  const y = safeNum(payload.year);
  const m = safeNum(payload.month);
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  const isHoliday = Array.isArray(payload.isHoliday) ? payload.isHoliday : new Array(daysInMonth).fill(false);
  const isTransferredOff = Array.isArray(payload.isTransferredOff) ? payload.isTransferredOff : new Array(daysInMonth).fill(false);
  const isShortDay = Array.isArray(payload.isShortDay) ? payload.isShortDay : new Array(daysInMonth).fill(false);

  let weekdays = 0;
  let holidayWeekdays = 0;
  let transferredWeekdays = 0;
  let shortWeekdays = 0;

  for (let i = 0; i < daysInMonth; i++) {
    if (isWeekendByIndex(y, m, i)) continue;
    weekdays++;

    if (isHoliday[i]) holidayWeekdays++;
    else if (isTransferredOff[i]) transferredWeekdays++;
    else if (isShortDay[i]) shortWeekdays++;
  }

  return (
    weekdays * baseDayHours -
    holidayWeekdays * baseDayHours -
    transferredWeekdays * baseDayHours -
    shortWeekdays * SHORT_DAY_REDUCTION_HOURS
  );
}

function getPayloadNormHoursForDay({
  y,
  m,
  index,
  baseDayHours,
  isHoliday,
  isTransferredOff,
  isShortDay,
}) {
  if (isWeekendByIndex(y, m, index)) return 0;
  if (isHoliday[index] || isTransferredOff[index]) return 0;
  return Math.max(0, baseDayHours - (isShortDay[index] ? SHORT_DAY_REDUCTION_HOURS : 0));
}

function getHolidayWorkedTotalsFromPayload(payload) {
  if (!payload || typeof payload !== "object") return { hDay: 0, hNight: 0 };

  const y = safeNum(payload.year);
  const m = safeNum(payload.month);
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  const isHoliday = Array.isArray(payload.isHoliday) ? payload.isHoliday : new Array(daysInMonth).fill(false);
  const leaveType = Array.isArray(payload.leaveType) ? payload.leaveType : new Array(daysInMonth).fill(null);
  const dayHours = Array.isArray(payload.dayHours) ? payload.dayHours : new Array(daysInMonth).fill(0);
  const nightHours = Array.isArray(payload.nightHours) ? payload.nightHours : new Array(daysInMonth).fill(0);

  let hDay = 0;
  let hNight = 0;

  for (let i = 0; i < daysInMonth; i++) {
    if (!isHoliday[i]) continue;
    if (normalizeLeaveTypeLegacy(leaveType[i])) continue;
    hDay += Number(dayHours[i]) || 0;
    hNight += Number(nightHours[i]) || 0;
  }

  return { hDay, hNight };
}

function resolveMoneySummaryFromPayload(payload, profile) {
  if (!payload || typeof payload !== "object") {
    return { net: 0, tax: 0 };
  }

  const moneyState = getTimesheetMoneyState(payload);
  const actual = moneyState.actual;
  const calculated = moneyState.calculated;

  if (moneyState.confirmed) {
    const baseNet =
      Number.isFinite(Number(actual.net))
        ? Number(actual.net)
        : Number.isFinite(Number(calculated?.net))
          ? Number(calculated.net)
          : 0;

    const paidLeaveNet =
      Number.isFinite(Number(actual.paidLeaveNet))
        ? Number(actual.paidLeaveNet)
        : 0;

    const calculatedTax =
      Number.isFinite(Number(calculated?.tax))
        ? Number(calculated.tax)
        : Number.isFinite(Number(payload?.paySummary?.tax))
          ? Number(payload.paySummary.tax)
          : 0;

    const taxOverride =
      Number.isFinite(Number(actual.paidLeaveTax))
        ? Number(actual.paidLeaveTax)
        : null;

    return {
      net: baseNet + paidLeaveNet,
      tax: taxOverride !== null ? taxOverride : calculatedTax,
    };
  }

  if (Number.isFinite(Number(calculated?.net)) || Number.isFinite(Number(calculated?.tax))) {
    return {
      net: Number.isFinite(Number(calculated?.net)) ? Number(calculated.net) : 0,
      tax: Number.isFinite(Number(calculated?.tax)) ? Number(calculated.tax) : 0,
    };
  }

  const legacyNet = Number(payload?.paySummary?.net);
  const legacyTax = Number(payload?.paySummary?.tax);
  if (Number.isFinite(legacyNet) || Number.isFinite(legacyTax)) {
    return {
      net: Number.isFinite(legacyNet) ? legacyNet : 0,
      tax: Number.isFinite(legacyTax) ? legacyTax : 0,
    };
  }

  const moneySnapshot = resolveMoneySnapshotFromPayload(payload, profile);
  const baseOklad = Number(moneySnapshot?.okladSnapshot);

  if (!(Number.isFinite(baseOklad) && baseOklad > 0)) {
    return { net: 0, tax: 0 };
  }

  const hazardRate = Number.isFinite(Number(moneySnapshot?.hazardRateSnapshot))
    ? Number(moneySnapshot.hazardRateSnapshot)
    : getHazardRateByPosition(profile?.position);

  const effectiveOklad =
    Number.isFinite(Number(moneySnapshot?.effectiveOkladSnapshot)) && Number(moneySnapshot.effectiveOkladSnapshot) > 0
      ? Number(moneySnapshot.effectiveOkladSnapshot)
      : baseOklad * (1 + hazardRate);

  const baseDayHours = getBaseDayHoursByProfile(profile);
  const monthNorm = computeCalendarNormFromPayload(payload, baseDayHours);

  if (!(monthNorm > 0)) {
    return { net: 0, tax: 0 };
  }

  const dayHours = Array.isArray(payload.dayHours) ? payload.dayHours : [];
  const nightHours = Array.isArray(payload.nightHours) ? payload.nightHours : [];

  const workedHours = sum(dayHours) + sum(nightHours);
  const totalNight = sum(nightHours);

  const calc = computeSalary({
    oklad: effectiveOklad,
    normHours: monthNorm,
    workedHours,
    nightHours: totalNight,
  });

  if (!calc?.ok || !calc.result) {
    return { net: 0, tax: 0 };
  }

  const r = calc.result;
  const { hDay, hNight } = getHolidayWorkedTotalsFromPayload(payload);
  const holidayTotal = hDay + hNight;

  const baseHourRateGross = effectiveOklad / monthNorm;
  const bonusPerHourGross = (effectiveOklad * BONUS_RATE) / monthNorm;

  const holidayExtraGross =
    (baseHourRateGross + bonusPerHourGross) * holidayTotal +
    baseHourRateGross * NIGHT_EXTRA_RATE * hNight;

  const holidayTax = holidayExtraGross * TAX_RATE;
  const holidayNet = holidayExtraGross - holidayTax;

  return {
    net: (Number(r.net) || 0) + holidayNet,
    tax: (Number(r.tax) || 0) + holidayTax,
  };
}

function isCompensatoryLeaveForYear(lt) {
  const t = normalizeLeaveTypeLegacy(lt);
  return t === "sick" ||
    t === "vac_unpaid" ||
    t === "vac_unpaid_required" ||
    t === "edu_paid" ||
    t === "edu_unpaid";
}

function computeCompensatoryLeaveHours(payload) {
  if (!payload || typeof payload !== "object") return 0;

  const y = safeNum(payload.year);
  const m = safeNum(payload.month);
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  const isHoliday = Array.isArray(payload.isHoliday) ? payload.isHoliday : new Array(daysInMonth).fill(false);
  const isTransferredOff = Array.isArray(payload.isTransferredOff) ? payload.isTransferredOff : new Array(daysInMonth).fill(false);
  const isShortDay = Array.isArray(payload.isShortDay) ? payload.isShortDay : new Array(daysInMonth).fill(false);
  const leaveType = Array.isArray(payload.leaveType) ? payload.leaveType : new Array(daysInMonth).fill(null);

  let effectiveHours = 0;
  for (let i = 0; i < daysInMonth; i++) {
    if (!isCompensatoryLeaveForYear(leaveType[i])) continue;
    effectiveHours += getPayloadNormHoursForDay({
      y,
      m,
      index: i,
      baseDayHours: BASE_DAY_HOURS,
      isHoliday,
      isTransferredOff,
      isShortDay,
    });
  }

  return effectiveHours;
}

function computeMonthOvertimeSigned(payload) {
  if (!payload || typeof payload !== "object") return 0;

  const y = safeNum(payload.year);
  const m = safeNum(payload.month);
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  const isHoliday = Array.isArray(payload.isHoliday) ? payload.isHoliday : new Array(daysInMonth).fill(false);
  const isTransferredOff = Array.isArray(payload.isTransferredOff) ? payload.isTransferredOff : new Array(daysInMonth).fill(false);
  const isShortDay = Array.isArray(payload.isShortDay) ? payload.isShortDay : new Array(daysInMonth).fill(false);
  const dayHours = Array.isArray(payload.dayHours) ? payload.dayHours : new Array(daysInMonth).fill(0);
  const nightHours = Array.isArray(payload.nightHours) ? payload.nightHours : new Array(daysInMonth).fill(0);
  const leaveType = Array.isArray(payload.leaveType) ? payload.leaveType : new Array(daysInMonth).fill(null);

  let weekdays = 0;
  let holidayWeekdays = 0;
  let transferredWeekdays = 0;
  let shortWeekdays = 0;

  for (let i = 0; i < daysInMonth; i++) {
    if (isWeekendByIndex(y, m, i)) continue;
    weekdays++;

    if (isHoliday[i]) holidayWeekdays++;
    else if (isTransferredOff[i]) transferredWeekdays++;
    else if (isShortDay[i]) shortWeekdays++;
  }

  const monthNorm =
    weekdays * BASE_DAY_HOURS -
    holidayWeekdays * BASE_DAY_HOURS -
    transferredWeekdays * BASE_DAY_HOURS -
    shortWeekdays * SHORT_DAY_REDUCTION_HOURS;

  let leaveEffectiveHours = 0;
  for (let i = 0; i < daysInMonth; i++) {
    const lt = normalizeLeaveTypeLegacy(leaveType[i]);
    if (!lt) continue;
    leaveEffectiveHours += getPayloadNormHoursForDay({
      y,
      m,
      index: i,
      baseDayHours: BASE_DAY_HOURS,
      isHoliday,
      isTransferredOff,
      isShortDay,
    });
  }

  const personalNorm = Math.max(0, monthNorm - leaveEffectiveHours);
  const workedTotal = sum(dayHours) + sum(nightHours);

  return workedTotal - personalNorm;
}

function fillYearOptions(currentYear) {
  if (!requireDom(yearSelect, "yearSelect")) return;
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
  yearSelect.value = String(currentYear);
}

function ensureYearOption(y) {
  if (!yearSelect) return;
  const exists = Array.from(yearSelect.options).some((o) => Number(o.value) === y);
  if (exists) return;
  const opt = document.createElement("option");
  opt.value = String(y);
  opt.textContent = String(y);
  yearSelect.appendChild(opt);
}

function applyOvertimeProgress(usedHoursForLimit) {
  if (!overtimeBarFill || !overtimeBarText) return;

  const used = Math.max(0, Number(usedHoursForLimit) || 0);
  const pct = Math.min(100, (used / OVERTIME_LIMIT_YEAR) * 100);

  overtimeBarText.textContent = `${used.toFixed(1)} / ${OVERTIME_LIMIT_YEAR} ч`;
  overtimeBarFill.style.width = `${pct}%`;

  overtimeBarFill.classList.remove(
    "bg-emerald-400/80",
    "bg-sky-400/80",
    "bg-amber-400/85",
    "bg-rose-400/85"
  );

  if (pct < 60) overtimeBarFill.classList.add("bg-emerald-400/80");
  else if (pct < 85) overtimeBarFill.classList.add("bg-sky-400/80");
  else if (pct < 100) overtimeBarFill.classList.add("bg-amber-400/85");
  else overtimeBarFill.classList.add("bg-rose-400/85");
}

function createTimesheetCard(row) {
  const y = row.year;
  const m = row.month;
  const updatedAt = row.updated_at ? new Date(row.updated_at) : null;

  const overtimeSigned = row.payload ? computeMonthOvertimeSigned(row.payload) : 0;

  const isOver = overtimeSigned > 0.0001;
  const isUnder = overtimeSigned < -0.0001;

  const actualLabel = getTimesheetActualSummaryLabel(row.payload);

  const card = document.createElement("div");
  card.className = "glass-card hover-lift rounded-3xl bg-slate-950/25 p-4 ring-1 ring-white/10";

  const top = document.createElement("div");
  top.className = "flex items-start justify-between gap-3";

  const left = document.createElement("div");
  left.className = "min-w-0";

  const title = document.createElement("div");
  title.className = "text-base font-semibold text-slate-100 truncate";
  title.textContent = `${monthNamesShort[m]} ${y}`;

  const meta = document.createElement("div");
  meta.className = "mt-1 text-xs text-slate-400/90";
  meta.textContent = updatedAt
    ? `Обновлён: ${updatedAt.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}`
    : "Обновлён: —";

  const dotClass = isOver ? "bg-amber-400/80" : isUnder ? "bg-rose-400/80" : "bg-emerald-400/80";
  const labelText = isOver ? "Переработка:" : isUnder ? "Недоработка:" : "По норме:";
  const valueClass = isUnder ? "text-rose-200" : "text-slate-100";
  const valueText = isOver ? formatHoursSigned(overtimeSigned) : isUnder ? formatHoursSigned(overtimeSigned) : "0.0 ч";

  const badges = document.createElement("div");
  badges.className = "mt-2 flex flex-wrap items-center gap-2";

  const ov = document.createElement("div");
  ov.className = "inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs ring-1 ring-white/10";
  ov.innerHTML = `<span class="h-1.5 w-1.5 rounded-full ${dotClass}"></span>
                  <span class="text-slate-200">${labelText}</span>
                  <span class="font-semibold ${valueClass}">${valueText}</span>`;

  badges.appendChild(ov);

  if (actualLabel) {
    const badge = document.createElement("div");
    badge.className =
      actualLabel.tone === "ok"
        ? "inline-flex items-center rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200 ring-1 ring-emerald-400/20"
        : actualLabel.tone === "warn"
          ? "inline-flex items-center rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-200 ring-1 ring-amber-400/20"
          : "inline-flex items-center rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200 ring-1 ring-white/10";
    badge.textContent = actualLabel.text;
    badges.appendChild(badge);
  }

  left.appendChild(title);
  left.appendChild(meta);
  left.appendChild(badges);

  const right = document.createElement("div");
  right.className = "flex flex-col gap-2";

  const openBtn = document.createElement("a");
  openBtn.href = `table.html?year=${y}&month=${m}`;
  openBtn.className =
    "rounded-2xl bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 ring-1 ring-white/10 hover:bg-white/10 text-center";
  openBtn.textContent = "Открыть";

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className =
    "rounded-2xl bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-200 ring-1 ring-rose-500/20 hover:bg-rose-500/15 active:scale-[0.985]";
  delBtn.textContent = "Удалить";

  delBtn.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Удалить табель?",
      message: `Табель за ${monthNamesShort[m]} ${y} будет удалён из профиля.`,
      note: "Это действие нельзя отменить.",
      confirmText: "Удалить",
      cancelText: "Оставить",
      tone: "danger",
    });
    if (!ok) return;

    setStatus("Удаляю…", "busy");
    setError(null);

    try {
      await deleteMyTimesheet(y, m);
      setStatus("Удалено", "ok");
      await refreshTimesheets();
      await renderCalendar();
    } catch (e) {
      setStatus("Ошибка удаления", "err");
      setError(e?.message || "Не удалось удалить табель.");
    }
  });

  right.appendChild(openBtn);
  right.appendChild(delBtn);

  top.appendChild(left);
  top.appendChild(right);

  card.appendChild(top);
  return card;
}

/* ========= Avatar helpers ========= */

function setAvatarHint(text) {
  if (!avatarHint) return;
  avatarHint.textContent = text || "";
}

function setAvatarUI(url, name) {
  if (url) {
    avatarImg.src = url;
    avatarImg.classList.remove("hidden");
    avatarFallback.classList.add("hidden");
    if (avatarRemoveBtn) avatarRemoveBtn.disabled = false;
  } else {
    avatarImg.removeAttribute("src");
    avatarImg.classList.add("hidden");
    avatarFallback.classList.remove("hidden");
    avatarFallback.textContent = (name?.trim?.()[0] || "A").toUpperCase();
    if (avatarRemoveBtn) avatarRemoveBtn.disabled = true;
  }
}

function guessExt(file) {
  const t = String(file?.type || "").toLowerCase();
  if (t.includes("jpeg")) return "jpg";
  if (t.includes("png")) return "png";
  if (t.includes("webp")) return "webp";
  return "png";
}

async function getUserIdOrThrow() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const uid = data?.session?.user?.id;
  if (!uid) throw new Error("NO_SESSION");
  return uid;
}

function extractAvatarPath(storedValue) {
  const value = String(storedValue || "").trim();
  if (!value) return null;

  if (!/^https?:\/\//i.test(value)) return value;

  try {
    const url = new URL(value);

    const signedMarker = `/storage/v1/object/sign/${AVATAR_BUCKET}/`;
    const publicMarker = `/storage/v1/object/public/${AVATAR_BUCKET}/`;

    const signedIdx = url.pathname.indexOf(signedMarker);
    if (signedIdx !== -1) {
      return decodeURIComponent(url.pathname.slice(signedIdx + signedMarker.length));
    }

    const publicIdx = url.pathname.indexOf(publicMarker);
    if (publicIdx !== -1) {
      return decodeURIComponent(url.pathname.slice(publicIdx + publicMarker.length));
    }

    return null;
  } catch {
    return null;
  }
}

function isAvatarObjectMissingError(error) {
  const message = String(error?.message || "").toLowerCase();
  const status = Number(error?.status);

  return (
    status === 400 ||
    status === 404 ||
    message.includes("object not found") ||
    message.includes("not found")
  );
}

async function cleanupBrokenAvatarReference(storedValue) {
  const path = extractAvatarPath(storedValue);
  if (!path) return;

  try {
    await updateMyProfile({ avatarUrl: null });
  } catch (e) {
    console.warn("Не удалось очистить битую ссылку на аватар:", e);
  }
}

async function createFreshAvatarUrl(storedValue) {
  const path = extractAvatarPath(storedValue);
  if (!path) return null;

  const { data, error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .createSignedUrl(path, 60 * 60);

  if (error) {
    if (isAvatarObjectMissingError(error)) {
      return null;
    }
    throw error;
  }

  return data?.signedUrl ?? null;
}

async function uploadAvatar(file) {
  if (!file) throw new Error("NO_FILE");
  if (!AVATAR_ALLOWED_TYPES.has(file.type)) throw new Error("Поддерживаются только JPG, PNG или WebP.");
  if (file.size > AVATAR_MAX_BYTES) throw new Error("Файл слишком большой. Максимум 2 MB.");

  const uid = await getUserIdOrThrow();
  const ext = guessExt(file);
  const path = `${uid}/avatar.${ext}`;

  const { data: existingFiles, error: listErr } = await supabase.storage
    .from(AVATAR_BUCKET)
    .list(uid, { limit: 100 });

  if (listErr) throw listErr;

  const filesToRemove = (existingFiles || []).map((f) => `${uid}/${f.name}`);
  if (filesToRemove.length) {
    const { error: rmErr } = await supabase.storage
      .from(AVATAR_BUCKET)
      .remove(filesToRemove);

    if (rmErr) throw rmErr;
  }

  const { error: upErr } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, file, {
      upsert: true,
      contentType: file.type,
      cacheControl: "3600",
    });

  if (upErr) throw upErr;

  await updateMyProfile({ avatarUrl: path });

  const freshUrl = await createFreshAvatarUrl(path);
  if (!freshUrl) throw new Error("Не удалось получить ссылку на аватар.");

  return freshUrl;
}

async function removeAvatar() {
  const uid = await getUserIdOrThrow();

  const { data: list, error: listErr } = await supabase.storage.from(AVATAR_BUCKET).list(uid, { limit: 100 });
  if (listErr) throw listErr;

  const files = (list || []).map((f) => `${uid}/${f.name}`);
  if (files.length) {
    const { error: rmErr } = await supabase.storage.from(AVATAR_BUCKET).remove(files);
    if (rmErr) throw rmErr;
  }

  await updateMyProfile({ avatarUrl: null });
}

avatarImg?.addEventListener("error", () => {
  const src = String(avatarImg?.src || "");
  if (src.startsWith("blob:")) return;

  setError("Аватар не загрузился по ссылке. Проверь доступ к Storage.");
  const name = displayNameEl?.textContent || "A";
  setAvatarUI(null, name);
});

/* ========= Profile load ========= */

async function refreshProfile() {
  setStatus("Загружаю профиль…", "busy");
  setError(null);

  const profile = await getMyProfile();
  currentProfile = profile ?? null;

    const effectiveProfile = profile ?? {
    display_name: "",
    position: "",
    gender: "",
    tab_number: "",
    branch: "",
    employment_date: "",
    oklad: null,
    role: "user",
    avatar_url: null,
    hide_money: false,
  };

    if (effectiveProfile.role === "owner") {
    ownerLink?.classList.remove("hidden");
  } else {
    ownerLink?.classList.add("hidden");
  }

  const name = effectiveProfile.display_name || "Пользователь";

  if (!requireDom(displayNameEl, "displayName")) return;
  if (!requireDom(displayNameInput, "displayNameInput")) return;
  if (!requireDom(tabNumberInput, "tabNumberInput")) return;
  if (!requireDom(branchSelect, "branchSelect")) return;
  if (!requireDom(employmentDateInput, "employmentDateInput")) return;
  if (!requireDom(okladInput, "okladInput")) return;
  if (!requireDom(positionSelect, "positionSelect")) return;

  const hideMoney = isMoneyProtectionEnabled(effectiveProfile);

  displayNameEl.textContent = name;
  profileFieldsTouched = false;
  applyExpectedProfileFieldValues(getExpectedProfileFieldValues(effectiveProfile));

  ensureProfileMoneyAccess = createMoneyAccessGuard(effectiveProfile, {
    title: "Показать скрытые суммы",
    description: "Введите 4-значный PIN-код, чтобы показать оклад и годовые итоги.",
    confirmText: "Показать",
  });

  okladVisible = !hideMoney;
  yearMoneyVisible = !hideMoney;
  syncProfileMoneyUi();
  guardProfileFieldsAgainstLateAutofill(effectiveProfile);

  BASE_DAY_HOURS = getBaseDayHoursByProfile(effectiveProfile);

  let avatarUrl = null;
  try {
    avatarUrl = await createFreshAvatarUrl(effectiveProfile.avatar_url || null);

    if (!avatarUrl && effectiveProfile.avatar_url) {
      await cleanupBrokenAvatarReference(effectiveProfile.avatar_url);
      effectiveProfile.avatar_url = null;
      if (currentProfile) currentProfile.avatar_url = null;
    }
  } catch (e) {
    console.warn("Не удалось получить свежую ссылку на аватар:", e);
  }

  setAvatarUI(avatarUrl, name);

  setAvatarUI(avatarUrl, name);

  const missingLabels = renderProfileRequiredNotice(effectiveProfile);
  applyRequiredFieldHighlights(effectiveProfile);

  if (missingLabels.length) {
    if (mustCompleteProfile) {
      setError(`Чтобы открыть табель, заполните обязательные поля: ${missingLabels.join(", ")}.`);
      setStatus("Табель пока недоступен", "err");
      focusFirstMissingRequiredField(effectiveProfile);
      return;
    }

    setStatus("Профиль загружен", "ok");
    return;
  }

  setError(null);
  setStatus("Профиль загружен", "ok");
}

/* ========= Production calendar + rendering ========= */

function prodCacheKey(y, m) {
  return `alvisa_prodcal_v1_${y}_${String(m + 1).padStart(2, "0")}`;
}

function parseProdMonth(text, daysInMonth) {
  const s = String(text ?? "").trim();
  if (!s || s.length < daysInMonth) return null;
  const out = [];
  for (let i = 0; i < daysInMonth; i++) {
    const ch = s[i];
    const n = Number(ch);
    out.push(Number.isFinite(n) ? n : 0);
  }
  return out.length === daysInMonth ? out : null;
}

async function getProductionMonth(y, m) {
  const days = new Date(y, m + 1, 0).getDate();
  const key = prodCacheKey(y, m);

  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && Array.isArray(obj.data) && obj.data.length === days) return obj.data;
    }
  } catch {}

  const mm = String(m + 1).padStart(2, "0");
  const url = `https://isdayoff.ru/api/getdata?year=${y}&month=${mm}&pre=1&holiday=1`;

  try {
    const resp = await fetch(url, { method: "GET" });
    if (!resp.ok) throw new Error(`HTTP_${resp.status}`);
    const txt = await resp.text();
    const parsed = parseProdMonth(txt, days);
    if (!parsed) throw new Error("BAD_PROD_DATA");

    try {
      localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data: parsed }));
    } catch {}

    return parsed;
  } catch {
    const out = [];
    for (let i = 0; i < days; i++) out.push(isWeekendByIndex(y, m, i) ? 1 : 0);
    return out;
  }
}

function initCalendarDow() {
  if (!calDowRow) return;
  if (calDowRow.childElementCount) return;
  for (const label of WEEK_LABELS) {
    const el = document.createElement("div");
    el.className = "cal-dow";
    el.textContent = label;
    calDowRow.appendChild(el);
  }
}

function mondayIndex(jsDay) {
  return (jsDay + 6) % 7;
}

function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function computeHeat(totalHours) {
  const HEAT_MAX = 12;
  return clamp01((Number(totalHours) || 0) / HEAT_MAX);
}

function getTimesheetForCalendarMonth() {
  if (calYear !== loadedYear) return null;
  return payloadByMonth.get(calMonth) ?? null;
}

async function renderCalendar() {
  if (!requireDom(calGrid, "calGrid")) return;
  if (!requireDom(calMonthLabel, "calMonthLabel")) return;

  initCalendarDow();

  const first = new Date(calYear, calMonth, 1);
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const lead = mondayIndex(first.getDay());
  const totalCells = Math.ceil((lead + daysInMonth) / 7) * 7;

  calMonthLabel.textContent = `${monthNamesFull[calMonth]} ${calYear}`;

  const prod = await getProductionMonth(calYear, calMonth);
  const payload = getTimesheetForCalendarMonth();

  const tsHoliday = Array.isArray(payload?.isHoliday) ? payload.isHoliday : null;
  const tsTransferredOff = Array.isArray(payload?.isTransferredOff) ? payload.isTransferredOff : null;
  const tsShort = Array.isArray(payload?.isShortDay) ? payload.isShortDay : null;
  const tsDay = Array.isArray(payload?.dayHours) ? payload.dayHours : null;
  const tsNight = Array.isArray(payload?.nightHours) ? payload.nightHours : null;
  const tsLeave = Array.isArray(payload?.leaveType) ? payload.leaveType : null;

  const today = new Date();
  const isThisMonth = today.getFullYear() === calYear && today.getMonth() === calMonth;
  const todayDay = isThisMonth ? today.getDate() : -1;

  calGrid.innerHTML = "";
  const frag = document.createDocumentFragment();

  for (let cell = 0; cell < totalCells; cell++) {
    const dayNum = cell - lead + 1;

    if (dayNum < 1 || dayNum > daysInMonth) {
      const empty = document.createElement("div");
      empty.className = "cal-cell cal-empty";
      frag.appendChild(empty);
      continue;
    }

    const idx = dayNum - 1;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cal-cell";

    const code = Number(prod?.[idx] ?? 0);
    const offHoliday = code === 8;
    const offShort = code === 2;
    const offWeekend = code === 1;

    if (offHoliday) btn.classList.add("cal-off-holiday");
    else if (offShort) btn.classList.add("cal-off-short");
    else if (offWeekend) btn.classList.add("cal-off-weekend");

    if (dayNum === todayDay) btn.classList.add("cal-today");

    const dh = Number(tsDay?.[idx] ?? 0);
    const nh = Number(tsNight?.[idx] ?? 0);
    const total = dh + nh;
    btn.style.setProperty("--heat", String(computeHeat(total)));

    const num = document.createElement("div");
    num.className = "cal-daynum";
    num.textContent = String(dayNum);
    btn.appendChild(num);

    const markHoliday = Boolean(tsHoliday?.[idx]);
    const markTransferred = Boolean(tsTransferredOff?.[idx]);
    const markShort = Boolean(tsShort?.[idx]);

    btn.classList.remove("cal-ts-holiday", "cal-ts-transferred", "cal-ts-short");

    if (markHoliday) btn.classList.add("cal-ts-holiday");
    else if (markTransferred) btn.classList.add("cal-ts-transferred");
    else if (markShort) btn.classList.add("cal-ts-short");

    const tags = document.createElement("div");
    tags.className = "cal-tags";

    const ltRaw = tsLeave?.[idx];
    const ltNorm = normalizeLeaveTypeLegacy(ltRaw);
    const ltCode = leaveTypeToCode(ltRaw);
    if (ltCode) {
      const t = document.createElement("span");
      t.className =
        ltNorm === "sick"
          ? "cal-tag sick"
          : ltNorm === NOT_EMPLOYED_LEAVE_TYPE
            ? "cal-tag not-employed"
            : "cal-tag leave";
      t.textContent = ltCode;
      tags.appendChild(t);
    }

    if ((Number(nh) || 0) > 0.0001) {
      const t = document.createElement("span");
      t.className = "cal-tag night";
      t.textContent = "Н";
      tags.appendChild(t);
    }

    if (tags.childElementCount) btn.appendChild(tags);

    const parts = [];
    if (total > 0) parts.push(`Часы: ${total.toFixed(1)} (день ${dh.toFixed(1)}, ночь ${nh.toFixed(1)})`);
    if (ltNorm) parts.push(leaveTypeToLabel(ltRaw));
    if (offHoliday) parts.push("Официальный праздник");
    if (offShort) parts.push("Официальный сокращённый");
    if (offWeekend) parts.push("Официальный выходной");
    if (markHoliday) parts.push("Отметка табеля: праздник");
    if (markTransferred) parts.push("Отметка табеля: перенесённый выходной");
    if (markShort) parts.push("Отметка табеля: сокращённый");
    btn.title = parts.length ? parts.join(" • ") : "Открыть табель";

    btn.addEventListener("click", () => {
      location.href = `table.html?year=${calYear}&month=${calMonth}&day=${dayNum}`;
    });

    frag.appendChild(btn);
  }

  calGrid.appendChild(frag);
}

async function shiftCalendarMonth(delta) {
  const next = new Date(calYear, calMonth + delta, 1);
  calYear = next.getFullYear();
  calMonth = next.getMonth();

  ensureYearOption(calYear);
  if (yearSelect && Number(yearSelect.value) !== calYear) {
    yearSelect.value = String(calYear);
    await refreshTimesheets();
  } else {
    await renderCalendar();
  }
}

async function refreshTimesheets() {
  if (!requireDom(yearSelect, "yearSelect")) return;
  if (!requireDom(timesheetsList, "timesheetsList")) return;
  if (!requireDom(overtimeYearEl, "overtimeYear")) return;
  if (!requireDom(overtimeRemainingEl, "overtimeRemaining")) return;
  if (!requireDom(yearNetIncomeEl, "yearNetIncome")) return;
  if (!requireDom(yearTaxPaidEl, "yearTaxPaid")) return;

  const y = Number(yearSelect.value);
  loadedYear = y;

  setStatus("Загружаю табели…", "busy");
  setError(null);

  const rows = await listMyTimesheetsByYear(y, { withPayload: true });

  payloadByMonth = new Map();
  for (const r of rows) {
    if (r && typeof r.month === "number" && r.payload) payloadByMonth.set(r.month, r.payload);
  }

  timesheetsList.innerHTML = "";

  let yearBalanceSigned = 0;
  let yearAdjustmentHours = 0;
  let yearNetIncome = 0;
  let yearTaxPaid = 0;

  for (const r of rows) {
    if (!r?.payload) continue;

    yearBalanceSigned += computeMonthOvertimeSigned(r.payload);
    yearAdjustmentHours += computeCompensatoryLeaveHours(r.payload);

    const money = resolveMoneySummaryFromPayload(r.payload, currentProfile);
    yearNetIncome += Number(money.net) || 0;
    yearTaxPaid += Number(money.tax) || 0;
  }

  const adjustedYearBalance = yearBalanceSigned - yearAdjustmentHours;

  const usedForLimit = Math.max(0, adjustedYearBalance);
  const remaining = Math.max(0, OVERTIME_LIMIT_YEAR - usedForLimit);

  overtimeYearEl.textContent = formatHoursSigned(adjustedYearBalance);
  overtimeRemainingEl.textContent = formatHoursPlain(remaining);
  yearNetIncomeText = formatMoney(yearNetIncome);
  yearTaxPaidText = formatMoney(yearTaxPaid);
  applyProfileYearVisibility();

  if (overtimeAdjustmentEl) {
    overtimeAdjustmentEl.textContent = `Коррекция отсутствиями (Б/ОД/ОЗ/У/УД): −${yearAdjustmentHours.toFixed(1)} ч`;
    overtimeAdjustmentEl.classList.toggle("hidden", !(yearAdjustmentHours > 0.0001));
  }

  applyOvertimeProgress(usedForLimit);

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "rounded-3xl bg-slate-950/25 p-4 ring-1 ring-white/10 text-sm text-slate-300/90";
    empty.textContent = "Пока нет сохранённых табелей за этот год.";
    timesheetsList.appendChild(empty);
    setStatus("Нечего показывать", "neutral");
    await renderCalendar();
    return;
  }

  rows.sort((a, b) => (a.month ?? 0) - (b.month ?? 0));
  for (const row of rows) timesheetsList.appendChild(createTimesheetCard(row));

  setStatus("Готово", "ok");

  if (calYear !== loadedYear) {
    calYear = loadedYear;
    calMonth = new Date().getMonth();
  }
  await renderCalendar();
}

async function saveProfile() {
  if (!requireDom(displayNameInput, "displayNameInput")) return;
  if (!requireDom(tabNumberInput, "tabNumberInput")) return;
  if (!requireDom(branchSelect, "branchSelect")) return;
  if (!requireDom(employmentDateInput, "employmentDateInput")) return;
  if (!requireDom(okladInput, "okladInput")) return;

  const displayName = displayNameInput.value.trim();
  const tabNumber = String(tabNumberInput.value || "").trim();
  const branch = branchSelect ? String(branchSelect.value || "") : "";
  const employmentDate = String(employmentDateInput?.value || "").trim();
  const oklad = parseNumber(okladInput.value);
  const position = positionSelect ? String(positionSelect.value || "") : "";
  const gender = genderSelect ? String(genderSelect.value || "") : "";

  if (displayName && displayName.length < 2) {
    setError("Имя слишком короткое (минимум 2 символа).");
    return;
  }
  if (okladInput.value.trim() && (!Number.isFinite(oklad) || oklad < 0)) {
    setError("Оклад должен быть числом ≥ 0.");
    return;
  }
  if (!POSITION_VALUES.has(position)) {
    setError("Некорректная должность.");
    return;
  }
  if (gender && gender !== "male" && gender !== "female") {
    setError("Пол должен быть: мужской или женский.");
    return;
  }
  if (!BRANCH_VALUES.has(branch)) {
    setError("Некорректный филиал.");
    return;
  }
  if (employmentDate && !/^\d{4}-\d{2}-\d{2}$/.test(employmentDate)) {
    setError("Некорректная дата трудоустройства.");
    return;
  }
  if (employmentDate) {
    const [dateYear, dateMonth, dateDay] = employmentDate.split("-").map(Number);
    const parsedEmploymentDate = new Date(dateYear, dateMonth - 1, dateDay);
    if (
      parsedEmploymentDate.getFullYear() !== dateYear ||
      parsedEmploymentDate.getMonth() !== dateMonth - 1 ||
      parsedEmploymentDate.getDate() !== dateDay
    ) {
      setError("Некорректная дата трудоустройства.");
      return;
    }
  }

  if (tabNumber.length > 64) {
    setError("Табельный номер слишком длинный.");
    return;
  }

  setStatus("Сохраняю…", "busy");
  setError(null);

  try {
    await updateMyProfile({
      displayName: displayName || null,
      tabNumber: tabNumber || null,
      branch: branch || null,
      employmentDate: employmentDate || null,
      oklad: okladInput.value.trim() ? oklad : null,
      position: position || null,
      gender: gender || null,
    });

    BASE_DAY_HOURS = getBaseDayHoursByProfile({ gender, branch });

    await refreshProfile();
    await refreshTimesheets();

    if (mustCompleteProfile) {
      if (isProfileCompleteForTimesheet(currentProfile)) {
        setStatus("Профиль заполнен", "ok");
        location.href = nextAfterProfile;
        return;
      }

      const missingLabels = getMissingRequiredProfileLabels(currentProfile);
      applyRequiredFieldHighlights(currentProfile);
      renderProfileRequiredNotice(currentProfile);
      focusFirstMissingRequiredField(currentProfile);
      setError(`Профиль ещё не заполнен. Обязательные поля: ${missingLabels.join(", ")}.`);
      setStatus("Заполните обязательные поля", "err");
      return;
    }

    setStatus("Сохранено", "ok");
  } catch (e) {
    setStatus("Ошибка сохранения", "err");
    setError(e?.message || "Не удалось сохранить профиль.");
  }
}

/* ========= events ========= */

logoutBtn?.addEventListener("click", async () => {
  try {
    await signOut();
  } finally {
    location.href = "login.html?next=profile.html";
  }
});

saveProfileBtn?.addEventListener("click", async (e) => {
  e.preventDefault();
  await saveProfile();
});

refreshBtn?.addEventListener("click", async () => {
  try {
    await refreshProfile();
    await refreshTimesheets();
  } catch (e) {
    setStatus("Ошибка", "err");
    setError(e?.message || "Не удалось обновить данные.");
  }
});

yearSelect?.addEventListener("change", async () => {
  calYear = Number(yearSelect.value);
  await refreshTimesheets();
});

calPrevBtn?.addEventListener("click", () => void shiftCalendarMonth(-1));
calNextBtn?.addEventListener("click", () => void shiftCalendarMonth(+1));
calTodayBtn?.addEventListener("click", async () => {
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
  ensureYearOption(calYear);
  if (yearSelect && Number(yearSelect.value) !== calYear) {
    yearSelect.value = String(calYear);
    await refreshTimesheets();
  } else {
    await renderCalendar();
  }
});

/* ===== Avatar events ===== */

avatarUploadBtn?.addEventListener("click", () => {
  setError(null);
  setAvatarHint("");
  avatarFileInput?.click();
});

avatarFileInput?.addEventListener("change", async () => {
  const file = avatarFileInput?.files?.[0];
  if (!file) return;

  try {
    setError(null);
    setStatus("Загружаю аватар…", "busy");
    setAvatarHint("Загрузка…");

    try {
      const localUrl = URL.createObjectURL(file);
      setAvatarUI(localUrl, displayNameEl?.textContent || "A");
    } catch {}

    const url = await uploadAvatar(file);
    setAvatarUI(url, displayNameEl?.textContent || "A");

    setAvatarHint("Готово");
    setStatus("Профиль обновлён", "ok");
  } catch (e) {
    setAvatarHint("");
    setStatus("Ошибка", "err");
    setError(e?.message || "Не удалось загрузить аватар.");
    try {
      await refreshProfile();
    } catch {}
  } finally {
    if (avatarFileInput) avatarFileInput.value = "";
  }
});

avatarRemoveBtn?.addEventListener("click", async () => {
  const ok = await confirmDialog({
    title: "Удалить аватар?",
    message: "Фото профиля будет удалено из личного кабинета.",
    confirmText: "Удалить",
    cancelText: "Оставить",
    tone: "danger",
  });
  if (!ok) return;

  try {
    setError(null);
    setStatus("Удаляю аватар…", "busy");
    setAvatarHint("Удаление…");

    await removeAvatar();

    const name = displayNameEl?.textContent || "A";
    setAvatarUI(null, name);

    setAvatarHint("Удалено");
    setStatus("Профиль обновлён", "ok");
  } catch (e) {
    setAvatarHint("");
    setStatus("Ошибка", "err");
    setError(e?.message || "Не удалось удалить аватар.");
    try {
      await refreshProfile();
    } catch {}
  }
});

hardenProfileAutofill();
for (const field of [displayNameInput, tabNumberInput, okladInput].filter(Boolean)) {
  field.addEventListener("beforeinput", markProfileTextInputTouched);
  field.addEventListener("keydown", markProfileFieldsTouched);
  field.addEventListener("paste", markProfileFieldsTouched);
  field.addEventListener("drop", markProfileFieldsTouched);
  field.addEventListener("compositionstart", markProfileFieldsTouched);
}
for (const field of [positionSelect, genderSelect, branchSelect, employmentDateInput].filter(Boolean)) {
  field.addEventListener("pointerdown", markProfileFieldsTouched);
  field.addEventListener("keydown", markProfileFieldsTouched);
  field.addEventListener("change", markProfileFieldsTouched);
}

employmentDateInput?.addEventListener("mouseenter", updateEmploymentDateHint);
employmentDateInput?.addEventListener("focus", updateEmploymentDateHint);
employmentDateInput?.addEventListener("input", updateEmploymentDateHint);
employmentDateInput?.addEventListener("change", updateEmploymentDateHint);

setupProfileMoneyControls();

/* ========= boot ========= */

(async () => {
  try {
    await requireSession();
  } catch {
    location.href = "login.html?next=profile.html";
    return;
  }

  startPresenceHeartbeat("Профиль");

  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();

  fillYearOptions(now.getFullYear());

  try {
    await refreshProfile();
    await refreshTimesheets();
  } catch (e) {
    setStatus("Ошибка загрузки", "err");
    setError(e?.message || "Не удалось загрузить данные кабинета.");
  }
})();

// ===== Кнопки обучения =====
const tourCalcBtn = document.getElementById("tourCalcBtn");
const tourTableBtn = document.getElementById("tourTableBtn");
const tourProfileBtn = document.getElementById("tourProfileBtn");

if (tourCalcBtn) {
  tourCalcBtn.addEventListener("click", () => {
    window.location.href = "index.html?tour=calculator";
  });
}
if (tourTableBtn) {
  tourTableBtn.addEventListener("click", () => {
    window.location.href = "table.html?tour=table";
  });
}
if (tourProfileBtn) {
  tourProfileBtn.addEventListener("click", () => {
    window.location.href = "profile.html?tour=profile";
  });
}
