// =========================
// FILE: /admin.js
// =========================
import { requireSession, signOut } from "./auth.js";
import {
  getMyManagedDepartment,
  getMyProfile,
  getDepartmentByKey,
  listManagedDepartmentMembers,
  managedListTimesheetsBefore,
  managedLoadTimesheet,
  managedSaveManyTimesheets,
  notifyPersonalTimesheetChanges,
  ownerCreateDepartmentInvite,
  sendPushNotifications,
} from "./db.js";
import { startPresenceHeartbeat } from "./presence.js";

import { exportDepartmentTimesheetXlsx } from "./excelExport.js";

document.body.classList.add("is-loaded");

const DEFAULT_DAY_HOURS = 8;
const FEMALE_DAY_HOURS = 7.2;
const CHATEAU_ALVISA_BRANCH = "chateau_alvisa";
const MAX_HOURS_PER_DAY = 24;
const MINOR_OVERTIME_LIMIT_HOURS = 10;
const SHORT_DAY_REDUCTION_HOURS = 1;
const NOT_EMPLOYED_LEAVE_TYPE = "not_employed";
const DISMISSED_LEAVE_TYPE = "dismissed";
const TABLE_DRAG_THRESHOLD_PX = 5;

const monthNames = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const monthNamesGenitive = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const DOW_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

const errorBox = document.getElementById("errorBox");
const logoutBtn = document.getElementById("logoutBtn");
const saveBtn = document.getElementById("saveBtn");
const reloadBtn = document.getElementById("reloadBtn");
const saveStatus = document.getElementById("saveStatus");

const monthSelect = document.getElementById("monthSelect");
const yearSelect = document.getElementById("yearSelect");
const monthYearDisplay = document.getElementById("monthYearDisplay");

const normMonthEl = document.getElementById("normMonth");
const normFirstHalfEl = document.getElementById("normFirstHalf");
const teamCountEl = document.getElementById("teamCount");

const headerRow = document.getElementById("headerRow");
const matrixBody = document.getElementById("matrixBody");
const tableScrollable = document.getElementById("tableScrollable");
const topTableScroll = document.getElementById("topTableScroll");
const topTableScrollSpacer = document.getElementById("topTableScrollSpacer");
const exportExcelBtn = document.getElementById("exportExcelBtn");
const createInviteBtn = document.getElementById("createInviteBtn");
const inviteBox = document.getElementById("inviteBox");
const inviteLinkInput = document.getElementById("inviteLinkInput");
const copyInviteBtn = document.getElementById("copyInviteBtn");

const backToTableLink = document.getElementById("backToTableLink");
const pageParams = new URLSearchParams(window.location.search);
const requestedDepartmentKey = String(pageParams.get("department") || "").trim();

let currentProfile = null;

let year = new Date().getFullYear();
let month = new Date().getMonth();
let daysInMonth = 31;

let managedDepartment = null;
let teamStates = [];
let sharedHoliday = [];
let sharedTransferredOff = [];
let sharedShortDay = [];
let headerCells = [];
let columnCells = [];
let focusedDayIndex = null;
let isScrolledX = false;
let horizontalScrollRaf = 0;
let resizeRaf = 0;
let isSyncingHorizontalScroll = false;
let tableDragState = null;

// Mobile toolbar
let mobileSelectedIdx = 0;
const mPrevDay = document.getElementById("mPrevDay");
const mNextDay = document.getElementById("mNextDay");
const mToday = document.getElementById("mToday");
const mHolidayBtn = document.getElementById("mHolidayBtn");
const mTransferredBtn = document.getElementById("mTransferredBtn");
const mShortBtn = document.getElementById("mShortBtn");
const mDayLabel = document.getElementById("mDayLabel");
const mEmployeeName = document.getElementById("mEmployeeName");

let dirty = false;
let lastSavedSignature = "";
let notificationBaselineByUserId = new Map();
let hasPendingPersonalPush = false;
let saveTimer = null;

function setError(msg) {
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

function isMobileNow() {
  return window.matchMedia?.("(max-width: 767px)")?.matches ?? (window.innerWidth < 768);
}

function syncHorizontalScrollState() {
  if (!tableScrollable) return;
  const next = tableScrollable.scrollLeft > 12;
  if (next === isScrolledX) return;
  isScrolledX = next;
  tableScrollable.classList.toggle("is-scrolled-x", next);
}

function syncTopTableScrollWidth() {
  if (!tableScrollable || !topTableScroll || !topTableScrollSpacer) return;

  const scrollWidth = tableScrollable.scrollWidth;
  topTableScrollSpacer.style.width = `${scrollWidth}px`;
  topTableScroll.classList.toggle("is-hidden", scrollWidth <= tableScrollable.clientWidth + 2);
  topTableScroll.scrollLeft = tableScrollable.scrollLeft;
}

function syncTopScrollFromTable() {
  if (!topTableScroll || !tableScrollable || isSyncingHorizontalScroll) return;

  isSyncingHorizontalScroll = true;
  topTableScroll.scrollLeft = tableScrollable.scrollLeft;
  isSyncingHorizontalScroll = false;
}

function syncTableScrollFromTop() {
  if (!topTableScroll || !tableScrollable || isSyncingHorizontalScroll) return;

  isSyncingHorizontalScroll = true;
  tableScrollable.scrollLeft = topTableScroll.scrollLeft;
  syncHorizontalScrollState();
  isSyncingHorizontalScroll = false;
}

function requestHorizontalScrollStateSync() {
  if (horizontalScrollRaf) return;

  horizontalScrollRaf = requestAnimationFrame(() => {
    horizontalScrollRaf = 0;
    syncHorizontalScrollState();
    syncTopScrollFromTable();
  });
}

function scrollTableToColumn(dayIdx0) {
  if (!tableScrollable) return;
  const cells = columnCells[dayIdx0];
  if (!cells || cells.length === 0) return;

  const firstCell = cells[0];
  const containerWidth = tableScrollable.clientWidth;
  const cellLeft = firstCell.offsetLeft;
  const cellWidth = firstCell.offsetWidth;
  const labelWidth = isMobileNow() ? 56 : 190;
  const targetScrollLeft =
    cellLeft - labelWidth - (containerWidth - labelWidth) / 2 + cellWidth / 2;

  tableScrollable.scrollTo({
    left: Math.max(0, targetScrollLeft),
    behavior: "smooth",
  });

  requestHorizontalScrollStateSync();
}


function clearFocusColumn(dayIdx = focusedDayIndex) {
  if (!Number.isInteger(dayIdx) || dayIdx < 0 || dayIdx >= daysInMonth) return;
  const cells = columnCells[dayIdx] ?? [];
  for (const el of cells) {
    el.classList.remove("focus-col");
  }
  if (focusedDayIndex === dayIdx) focusedDayIndex = null;
}

function focusDayColumn(dayIdx0) {
  if (!Number.isInteger(dayIdx0) || dayIdx0 < 0 || dayIdx0 >= daysInMonth) return;
  if (focusedDayIndex === dayIdx0) return;

  clearFocusColumn();
  const cells = columnCells[dayIdx0] ?? [];
  for (const cell of cells) {
    cell.classList.add("focus-col");
  }
  focusedDayIndex = dayIdx0;
}

function updateMobileToolbar() {
  const idx = mobileSelectedIdx;
  if (idx < 0 || idx >= daysInMonth) return;

  const d = new Date(year, month, idx + 1);
  mDayLabel.textContent = `${idx + 1} · ${DOW_SHORT[d.getDay()]}`;
  mHolidayBtn?.classList.toggle("is-active", Boolean(sharedHoliday[idx]));
  mTransferredBtn?.classList.toggle("is-active", Boolean(sharedTransferredOff[idx]));
  mShortBtn?.classList.toggle("is-active", Boolean(sharedShortDay[idx]));
}

function setMobileDay(dayIdx0, options = {}) {
  const shouldScroll = options.scroll !== false;

  if (dayIdx0 < 0) dayIdx0 = 0;
  if (dayIdx0 >= daysInMonth) dayIdx0 = daysInMonth - 1;

  mobileSelectedIdx = dayIdx0;
  focusDayColumn(dayIdx0);
  if (shouldScroll) scrollTableToColumn(dayIdx0);
  updateMobileToolbar();
}

function setMobileEmployee(activeState) {
  if (!mEmployeeName) return;
  mEmployeeName.textContent = activeState?.name || "—";

  for (const state of teamStates) {
    state.labelCell?.classList.toggle("is-mobile-active", state === activeState);
  }
}

function setSaveStatus(text, tone = "neutral") {
  saveStatus.textContent = text;
  saveStatus.className =
    "inline-flex items-center rounded-full px-4 py-1.5 text-xs ring-1";

  if (tone === "ok") {
    saveStatus.classList.add("bg-emerald-500/10", "text-emerald-200", "ring-emerald-400/20");
    return;
  }
  if (tone === "err") {
    saveStatus.classList.add("bg-rose-500/10", "text-rose-200", "ring-rose-400/20");
    return;
  }
  if (tone === "busy") {
    saveStatus.classList.add("bg-sky-500/10", "text-sky-200", "ring-sky-400/20");
    return;
  }

  saveStatus.classList.add("bg-white/5", "text-slate-300", "ring-white/10");
}

function parseNumberValue(raw) {
  const s = String(raw ?? "").trim().replace(/\s+/g, "").replace(",", ".");
  if (!s) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function sumArr(arr) {
  return arr.reduce((acc, n) => acc + (Number.isFinite(n) ? n : 0), 0);
}

function sumRange(arr, startIdx, endIdxInclusive) {
  let total = 0;
  for (let i = startIdx; i <= endIdxInclusive; i++) {
    total += Number.isFinite(arr[i]) ? arr[i] : 0;
  }
  return total;
}

function fmtHours(n) {
  const value = Number(n);
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(1).replace(/\.0$/, "");
}

function isWeekendByIndex(y, m, dayIndex0) {
  const d = new Date(y, m, dayIndex0 + 1).getDay();
  return d === 0 || d === 6;
}

function getBaseDayHours(gender, branch) {
  return gender === "female" && branch === CHATEAU_ALVISA_BRANCH
    ? FEMALE_DAY_HOURS
    : DEFAULT_DAY_HOURS;
}

function normHoursForDay(index, baseDayHours) {
  if (isWeekendByIndex(year, month, index)) return 0;
  if (sharedHoliday[index] || sharedTransferredOff[index]) return 0;
  return Math.max(0, baseDayHours - (sharedShortDay[index] ? SHORT_DAY_REDUCTION_HOURS : 0));
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

function applyEmploymentDateDefaultsToState(state) {
  const employmentDate = parseIsoDateLocal(state?.employmentDate);
  if (!employmentDate) return;

  const baseDayHours = getBaseDayHours(state.gender, state.branch);

  for (let i = 0; i < daysInMonth; i += 1) {
    const date = new Date(year, month, i + 1);
    date.setHours(0, 0, 0, 0);
    if (date >= employmentDate) continue;
    if (normHoursForDay(i, baseDayHours) <= 0) continue;
    if (normalizeLeaveTypeLegacy(state.leaveType[i])) continue;
    if ((Number(state.dayHours[i]) || 0) > 0 || (Number(state.nightHours[i]) || 0) > 0) continue;

    state.leaveType[i] = NOT_EMPLOYED_LEAVE_TYPE;
  }
}

function isDismissedLeaveType(leaveTypeValue) {
  return normalizeLeaveTypeLegacy(leaveTypeValue) === DISMISSED_LEAVE_TYPE;
}

function isNormAffectingLeaveType(leaveTypeValue) {
  const leave = normalizeLeaveTypeLegacy(leaveTypeValue);
  return Boolean(leave && leave !== DISMISSED_LEAVE_TYPE);
}

function findDismissalIndex(state) {
  if (state?.dismissedBeforeMonth) return -1;
  return state?.leaveType?.findIndex((leave) => isDismissedLeaveType(leave)) ?? -1;
}

function payloadHasDismissal(payload) {
  if (!payload || !Array.isArray(payload.leaveType)) return false;
  return payload.leaveType.some((leave) => isDismissedLeaveType(leave));
}

function applyDismissalsBeforeMonth(rows) {
  const dismissedUsers = new Set();

  for (const row of rows ?? []) {
    if (payloadHasDismissal(row?.payload)) dismissedUsers.add(String(row.user_id));
  }

  for (const state of teamStates) {
    state.dismissedBeforeMonth = dismissedUsers.has(String(state.userId));
  }
}

function sanitizeDayCellValue(raw) {
  let s = String(raw ?? "").toUpperCase();
  s = s
    .replaceAll("O", "О")
    .replaceAll("T", "Т")
    .replaceAll("B", "Б")
    .replaceAll("D", "Д")
    .replaceAll("Z", "З")
    .replaceAll("U", "У")
    .replaceAll("Y", "У")
    .replaceAll("N", "Н")
    .replaceAll("V", "В");

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
    num =
      num.slice(0, sepIdx) +
      num[sepIdx] +
      num.slice(sepIdx + 1).replace(/[.,]/g, "");
  }

  return num;
}

function sanitizeNumericValue(raw) {
  let s = String(raw ?? "").trim().replace(/\s+/g, "").replace(/[^0-9.,]/g, "");
  if (!s) return "";

  if (s.includes(".") && s.includes(",")) s = s.replace(/,/g, ".");
  const sepIdx = s.search(/[.,]/);
  if (sepIdx !== -1) {
    s =
      s.slice(0, sepIdx) +
      s[sepIdx] +
      s.slice(sepIdx + 1).replace(/[.,]/g, "");
  }

  return s;
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

function normalizeLeaveToken(raw) {
  const s0 = String(raw ?? "").trim().toUpperCase();
  if (!s0) return null;

  const s = s0
    .replaceAll("O", "О")
    .replaceAll("T", "Т")
    .replaceAll("B", "Б")
    .replaceAll("D", "Д")
    .replaceAll("Z", "З")
    .replaceAll("U", "У")
    .replaceAll("Y", "У")
    .replaceAll("L", "Л")
    .replaceAll("N", "Н")
    .replaceAll("V", "В");

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

  const n = parseNumberValue(raw);
  if (!Number.isFinite(n)) return { kind: "invalid" };

  return { kind: "hours", hours: n };
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

function markDirty() {
  dirty = true;
  setSaveStatus("Есть несохранённые изменения", "neutral");
}

function revertToPrev(inputEl) {
  inputEl.value = inputEl.dataset.prev ?? "";
}

function buildMemberLabel(member) {
  return (
    String(member?.display_name ?? "").trim() ||
    String(member?.position ?? "").trim() ||
    `Сотрудник ${String(member?.user_id ?? "").slice(0, 8)}`
  );
}

function createState(member) {
  return {
    userId: member.user_id,
    name: buildMemberLabel(member),
    gender: member?.gender ?? null,
    branch: member?.branch ?? null,
    employmentDate: member?.employment_date ?? null,
    dismissedBeforeMonth: false,
    position: member?.position ?? "",
    tabNumber: member?.tab_number ?? "",
    dayHours: new Array(daysInMonth).fill(0),
    nightHours: new Array(daysInMonth).fill(0),
    leaveType: new Array(daysInMonth).fill(null),
    dayInputs: [],
    nightInputs: [],
    summaryEl: null,
    labelCell: null,
    dayRowEl: null,
    nightRowEl: null,
  };
}

function setFromQueryOrNow() {
  const u = new URL(location.href);
  const hasYear = u.searchParams.has("year");
  const hasMonth = u.searchParams.has("month");
  const qYear = Number(u.searchParams.get("year"));
  const qMonth = Number(u.searchParams.get("month"));

  if (!hasYear && !hasMonth) {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth();
  } else {
    if (Number.isInteger(qYear) && qYear >= 2000 && qYear <= 2100) year = qYear;
    if (Number.isInteger(qMonth) && qMonth >= 0 && qMonth <= 11) month = qMonth;
  }

  monthSelect.value = String(month);
}

function fillYearOptions() {
  const nowY = new Date().getFullYear();
  yearSelect.innerHTML = "";
  for (let y = nowY - 2; y <= nowY + 2; y++) {
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

function resetMonthArrays(members) {
  daysInMonth = new Date(year, month + 1, 0).getDate();
  sharedHoliday = new Array(daysInMonth).fill(false);
  sharedTransferredOff = new Array(daysInMonth).fill(false);
  sharedShortDay = new Array(daysInMonth).fill(false);
  headerCells = [];
  columnCells = Array.from({ length: daysInMonth }, () => []);
  focusedDayIndex = null;
  teamStates = (members ?? []).map((member) => createState(member));
}

function hasSharedMarks(payload) {
  return Boolean(
    payload &&
    Array.isArray(payload.isHoliday) &&
    payload.isHoliday.length === daysInMonth
  );
}

function hasDepartmentSharedMarks(payload) {
  if (!hasSharedMarks(payload)) return false;
  if (payload.sharedMarksSource !== "department") return false;
  return !payload.sharedMarksDepartmentKey || payload.sharedMarksDepartmentKey === managedDepartment?.key;
}

function getSharedMarkCode(payload, index) {
  if (payload.isHoliday?.[index]) return "holiday";
  if (payload.isTransferredOff?.[index]) return "transferred";
  if (payload.isShortDay?.[index]) return "short";
  return "none";
}

function chooseSharedMarkSet(payloadsByUserId) {
  const payloads = Array.from(payloadsByUserId.values())
    .filter(hasSharedMarks)
    .filter((payload) => payload.sharedMarksSource !== "personal");
  if (!payloads.length) return null;

  const departmentPayloads = payloads.filter(hasDepartmentSharedMarks);
  const sources = departmentPayloads.length ? departmentPayloads : payloads;
  const nextHoliday = new Array(daysInMonth).fill(false);
  const nextTransferred = new Array(daysInMonth).fill(false);
  const nextShort = new Array(daysInMonth).fill(false);

  for (let i = 0; i < daysInMonth; i++) {
    const counts = { none: 0, holiday: 0, transferred: 0, short: 0 };

    for (const payload of sources) {
      counts[getSharedMarkCode(payload, i)] += 1;
    }

    let best = "none";
    for (const code of ["holiday", "transferred", "short"]) {
      if (counts[code] > counts[best]) best = code;
    }

    nextHoliday[i] = best === "holiday";
    nextTransferred[i] = best === "transferred";
    nextShort[i] = best === "short";
  }

  return {
    isHoliday: nextHoliday,
    isTransferredOff: nextTransferred,
    isShortDay: nextShort,
  };
}

function applyLoadedPayloads(payloadsByUserId) {
  const sharedSource = chooseSharedMarkSet(payloadsByUserId);

  if (sharedSource?.isHoliday?.length === daysInMonth) {
    sharedHoliday = sharedSource.isHoliday.map(Boolean);
  }
  if (sharedSource?.isTransferredOff?.length === daysInMonth) {
    sharedTransferredOff = sharedSource.isTransferredOff.map(Boolean);
  }
  if (sharedSource?.isShortDay?.length === daysInMonth) {
    sharedShortDay = sharedSource.isShortDay.map(Boolean);
  }

  for (const state of teamStates) {
    const payload = payloadsByUserId.get(state.userId);

    if (payload?.dayHours?.length === daysInMonth) {
      state.dayHours = payload.dayHours.map((x) => sanitizeHourNumber(Number(x)));
    }
    if (payload?.nightHours?.length === daysInMonth) {
      state.nightHours = payload.nightHours.map((x) => sanitizeHourNumber(Number(x)));
    }
    if (payload?.leaveType?.length === daysInMonth) {
      state.leaveType = payload.leaveType.map((x) => normalizeLeaveTypeLegacy(x));
    }

    applyEmploymentDateDefaultsToState(state);
  }
}

function makeInitials(name) {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const raw = parts.length >= 2
    ? `${parts[0][0] || ""}${parts[1][0] || ""}`
    : String(name ?? "").slice(0, 2);

  return raw.toUpperCase() || "С";
}

function makeLabelCell(state) {
  const td = document.createElement("td");
  td.className = "label-cell";
  td.rowSpan = 2;
  td.title = state.name || "Сотрудник";

  const main = document.createElement("span");
  main.className = "label-main";
  main.textContent = state.name;

  const overtimeBadge = document.createElement("span");
  overtimeBadge.className = "label-overtime-badge is-hidden";
  state.overtimeBadge = overtimeBadge;

  const titleRow = document.createElement("span");
  titleRow.className = "label-title-row";
  titleRow.append(main, overtimeBadge);

  const sub = document.createElement("span");
  sub.className = "label-sub";
  sub.textContent = "День / Ночь";

  const avatar = document.createElement("span");
  avatar.className = "label-avatar";
  avatar.textContent = makeInitials(state.name);

  td.addEventListener("click", () => {
    if (isMobileNow()) setMobileEmployee(state);
  });

  td.append(avatar, titleRow, sub);
  return td;
}

function setSharedDayMarkByCycle(dayIndex, clickCount) {
  if (clickCount === 1) return setSharedDayMark(dayIndex, "holiday");
  if (clickCount === 2) return setSharedDayMark(dayIndex, "transferred");
  return setSharedDayMark(dayIndex, "short");
}

function setSharedDayMark(dayIndex, type) {
  const nextHoliday = type === "holiday";
  const nextTransferred = type === "transferred";
  const nextShort = type === "short";
  const changed =
    sharedHoliday[dayIndex] !== nextHoliday ||
    sharedTransferredOff[dayIndex] !== nextTransferred ||
    sharedShortDay[dayIndex] !== nextShort;

  sharedHoliday[dayIndex] = nextHoliday;
  sharedTransferredOff[dayIndex] = nextTransferred;
  sharedShortDay[dayIndex] = nextShort;

  return changed;
}

function clearSharedDayMark(dayIndex) {
  const changed =
    Boolean(sharedHoliday[dayIndex]) ||
    Boolean(sharedTransferredOff[dayIndex]) ||
    Boolean(sharedShortDay[dayIndex]);

  sharedHoliday[dayIndex] = false;
  sharedTransferredOff[dayIndex] = false;
  sharedShortDay[dayIndex] = false;

  return changed;
}

function createHeaderCell(dayIndex) {
  const th = document.createElement("th");
  th.dataset.dayIndex = String(dayIndex);
  th.tabIndex = 0;

  const dayNumber = dayIndex + 1;
  const weekday = new Date(year, month, dayNumber).getDay();
  const weekend = isWeekendByIndex(year, month, dayIndex);

  const numEl = document.createElement("span");
  numEl.textContent = String(dayNumber);

  const dowEl = document.createElement("span");
  dowEl.className = "th-dow";
  dowEl.textContent = DOW_SHORT[weekday];
  if (weekend) dowEl.style.color = "rgba(252, 165, 165, 0.8)";

  th.append(numEl, dowEl);
  th.style.cursor = "pointer";
  th.title = "1 клик — праздник. 2 клика — перенесённый выходной. 3 клика — сокращённый день. ПКМ — очистить.";

  let clickCount = 0;
  let clickTimer = null;

  const markByPointerCount = () => {
    clickCount += 1;
    if (clickTimer) clearTimeout(clickTimer);

    clickTimer = setTimeout(() => {
      const changed = setSharedDayMarkByCycle(dayIndex, clickCount >= 3 ? 3 : clickCount);
      clickCount = 0;
      clickTimer = null;

      updateDayMarkClasses(dayIndex);
      renderSharedSummary();
      recalcAllPeople();
      if (changed) scheduleSave();
      updateMobileToolbar();
    }, 320);
  };

  th.addEventListener("pointerup", (e) => {
    if (e.pointerType === "touch") {
      setMobileDay(dayIndex);
      return;
    }

    if (e.button !== 0) return;

    setMobileDay(dayIndex, { scroll: false });
    markByPointerCount();
  });

  th.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    setMobileDay(dayIndex, { scroll: false });
    markByPointerCount();
  });

  th.addEventListener("contextmenu", (e) => {
    e.preventDefault();

    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    clickCount = 0;

    if (isMobileNow()) setMobileDay(dayIndex);

    const changed = clearSharedDayMark(dayIndex);
    updateDayMarkClasses(dayIndex);
    renderSharedSummary();
    recalcAllPeople();
    if (changed) scheduleSave();
    updateMobileToolbar();
  });

  return th;
}

function currentPayloadForState(state) {
  return {
    v: 5,
    year,
    month,
    sharedMarksSource: "department",
    sharedMarksDepartmentKey: managedDepartment?.key ?? null,
    isHoliday: [...sharedHoliday],
    isTransferredOff: [...sharedTransferredOff],
    isShortDay: [...sharedShortDay],
    dayHours: [...state.dayHours],
    nightHours: [...state.nightHours],
    leaveType: [...state.leaveType],
  };
}

function currentSaveItems() {
  return teamStates.map((state) => ({
    user_id: state.userId,
    year,
    month,
    payload: currentPayloadForState(state),
  }));
}

function currentSignature() {
  return JSON.stringify(currentSaveItems());
}

function notificationSnapshotForState(state) {
  return {
    isHoliday: sharedHoliday.map(Boolean),
    isTransferredOff: sharedTransferredOff.map(Boolean),
    isShortDay: sharedShortDay.map(Boolean),
    dayHours: state.dayHours.map((value) => sanitizeHourNumber(Number(value))),
    nightHours: state.nightHours.map((value) => sanitizeHourNumber(Number(value))),
    leaveType: state.leaveType.map((value) => normalizeLeaveTypeLegacy(value)),
  };
}

function resetNotificationBaseline() {
  notificationBaselineByUserId = new Map(
    teamStates.map((state) => [state.userId, notificationSnapshotForState(state)])
  );
}

function updateNotificationBaseline(userIds) {
  const ids = new Set((Array.isArray(userIds) ? userIds : []).map(String));

  for (const state of teamStates) {
    if (!ids.has(String(state.userId))) continue;
    notificationBaselineByUserId.set(state.userId, notificationSnapshotForState(state));
  }
}

function notificationCellLabel(snapshot, index) {
  const leaveCode = leaveTypeToCode(snapshot?.leaveType?.[index], "ОТ");
  if (leaveCode) return leaveCode;

  const day = sanitizeHourNumber(Number(snapshot?.dayHours?.[index]));
  const night = sanitizeHourNumber(Number(snapshot?.nightHours?.[index]));
  const parts = [];

  if (day > 0) parts.push(`${fmtHours(day)} ч день`);
  if (night > 0) parts.push(`${fmtHours(night)} ч ночь`);

  return parts.length ? parts.join(" + ") : "выходной";
}

function notificationDayMarkLabel(snapshot, index) {
  if (snapshot?.isHoliday?.[index]) return "праздничный день";
  if (snapshot?.isTransferredOff?.[index]) return "перенесённый выходной";
  if (snapshot?.isShortDay?.[index]) return "сокращённый день";
  return "обычный день";
}

function notificationNumberChanged(previous, current) {
  return Math.abs(Number(previous || 0) - Number(current || 0)) > 1e-9;
}

function collectPersonalTimesheetChanges() {
  const result = [];

  for (const state of teamStates) {
    const previous = notificationBaselineByUserId.get(state.userId);
    if (!previous) continue;

    const current = notificationSnapshotForState(state);
    const dayChanges = [];

    for (let index = 0; index < daysInMonth; index += 1) {
      const cellChanged =
        notificationNumberChanged(previous.dayHours?.[index], current.dayHours?.[index]) ||
        notificationNumberChanged(previous.nightHours?.[index], current.nightHours?.[index]) ||
        normalizeLeaveTypeLegacy(previous.leaveType?.[index]) !==
          normalizeLeaveTypeLegacy(current.leaveType?.[index]);

      const markChanged =
        Boolean(previous.isHoliday?.[index]) !== Boolean(current.isHoliday?.[index]) ||
        Boolean(previous.isTransferredOff?.[index]) !== Boolean(current.isTransferredOff?.[index]) ||
        Boolean(previous.isShortDay?.[index]) !== Boolean(current.isShortDay?.[index]);

      if (!cellChanged && !markChanged) continue;

      const details = [];
      if (cellChanged) {
        details.push(
          `${notificationCellLabel(previous, index)} → ${notificationCellLabel(current, index)}`
        );
      }
      if (markChanged) {
        details.push(
          `${notificationDayMarkLabel(previous, index)} → ${notificationDayMarkLabel(current, index)}`
        );
      }

      dayChanges.push(`${index + 1} ${monthNamesGenitive[month]}: ${details.join(", ")}`);
    }

    if (!dayChanges.length) continue;

    const visibleChanges = dayChanges.slice(0, 3);
    const hiddenCount = dayChanges.length - visibleChanges.length;
    const summary = `${visibleChanges.join("; ")}${
      hiddenCount > 0 ? `; ещё изменений: ${hiddenCount}` : ""
    }.`;

    result.push({
      userId: state.userId,
      summary,
    });
  }

  return result;
}

function lockNightCell(state, i) {
  const el = state.nightInputs[i];
  if (!el) return;
  el.value = "";
  el.dataset.prev = "";
  el.disabled = true;
  el.classList.add("opacity-50", "cursor-not-allowed");
  el.title = "Недоступно для заполнения";
}

function unlockNightCell(state, i) {
  const el = state.nightInputs[i];
  if (!el) return;
  el.disabled = false;
  el.classList.remove("opacity-50", "cursor-not-allowed");
  el.title = "";
}

function lockDayCell(state, i) {
  const el = state.dayInputs[i];
  if (!el) return;
  el.disabled = true;
  el.classList.add("opacity-50", "cursor-not-allowed");
  el.title = "Сотрудник уволен, дальнейшее заполнение заблокировано";
}

function unlockDayCell(state, i) {
  const el = state.dayInputs[i];
  if (!el) return;
  el.disabled = false;
  el.classList.remove("opacity-50", "cursor-not-allowed");
  el.title = "";
}

function clearDismissalTailForState(state, startIndex) {
  for (let i = startIndex; i < daysInMonth; i += 1) {
    if (!isDismissedLeaveType(state.leaveType[i])) continue;
    state.leaveType[i] = null;
    state.dayHours[i] = 0;
    state.nightHours[i] = 0;
    if (state.dayInputs[i]) {
      state.dayInputs[i].value = "";
      state.dayInputs[i].dataset.prev = "";
    }
    if (state.nightInputs[i]) {
      state.nightInputs[i].value = "";
      state.nightInputs[i].dataset.prev = "";
    }
  }
}

function applyDismissalLockToState(state, { clearFuture = true } = {}) {
  const dismissalIndex = findDismissalIndex(state);
  const hasDismissal = state.dismissedBeforeMonth || dismissalIndex >= 0;

  for (let i = 0; i < daysInMonth; i += 1) {
    const isAfterDismissal = state.dismissedBeforeMonth || (dismissalIndex >= 0 && i > dismissalIndex);

    if (isAfterDismissal) {
      if (clearFuture) {
        state.dayHours[i] = 0;
        state.nightHours[i] = 0;
        state.leaveType[i] = DISMISSED_LEAVE_TYPE;
        if (state.dayInputs[i]) {
          state.dayInputs[i].value = "УВ";
          state.dayInputs[i].dataset.prev = "УВ";
        }
        if (state.nightInputs[i]) {
          state.nightInputs[i].value = "";
          state.nightInputs[i].dataset.prev = "";
        }
      }
      lockDayCell(state, i);
      lockNightCell(state, i);
      continue;
    }

    unlockDayCell(state, i);

    if (normalizeLeaveTypeLegacy(state.leaveType[i])) lockNightCell(state, i);
    else unlockNightCell(state, i);
  }

  state.labelCell?.classList.toggle("is-dismissed", hasDismissal);
}

function clampDayTotalOrRevert({ state, index, nextDay, nextNight, onRevert }) {
  const d = sanitizeHourNumber(nextDay);
  const n = sanitizeHourNumber(nextNight);

  if (d > MAX_HOURS_PER_DAY || n > MAX_HOURS_PER_DAY || d + n > MAX_HOURS_PER_DAY) {
    setError(`В сутки нельзя больше ${MAX_HOURS_PER_DAY} ч. Проверьте ${state.name}, день ${index + 1}.`);
    onRevert?.();
    return false;
  }
  return true;
}

function getMatrixViewportBounds() {
  let top = 12;
  let bottom = window.innerHeight - 20;

  for (const selector of [".app-top-header", "#mobileBar", "#topTableScroll"]) {
    const el = document.querySelector(selector);
    if (!(el instanceof HTMLElement)) continue;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;

    const rect = el.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) continue;

    top = Math.max(top, rect.bottom + 12);
  }

  return { top, bottom };
}

function scrollElementIntoContainerView(el, container) {
  if (!(el instanceof HTMLElement) || !(container instanceof HTMLElement)) return;
  if (container.scrollHeight <= container.clientHeight + 2) return;

  const rect = el.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const topEdge = containerRect.top + 12;
  const bottomEdge = containerRect.bottom - 12;

  if (rect.top < topEdge) {
    container.scrollTop += rect.top - topEdge;
  } else if (rect.bottom > bottomEdge) {
    container.scrollTop += rect.bottom - bottomEdge;
  }
}

function scrollWindowToMatrixCell(el) {
  if (!(el instanceof HTMLElement)) return;

  const rect = el.getBoundingClientRect();
  const bounds = getMatrixViewportBounds();

  if (rect.top < bounds.top) {
    window.scrollBy({ top: rect.top - bounds.top, left: 0, behavior: "auto" });
  } else if (rect.bottom > bounds.bottom) {
    window.scrollBy({ top: rect.bottom - bounds.bottom, left: 0, behavior: "auto" });
  }
}

function scrollMatrixCellHorizontal(el) {
  if (!(el instanceof HTMLElement) || !tableScrollable) return;

  const rect = el.getBoundingClientRect();
  const containerRect = tableScrollable.getBoundingClientRect();
  const leftEdge = containerRect.left + (isMobileNow() ? 58 : 200);
  const rightEdge = containerRect.right - 14;

  if (rect.left < leftEdge) {
    tableScrollable.scrollLeft += rect.left - leftEdge;
  } else if (rect.right > rightEdge) {
    tableScrollable.scrollLeft += rect.right - rightEdge;
  }

  requestHorizontalScrollStateSync();
}

function focusInputWithoutAutoScroll(el) {
  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
}

function ensureMatrixCellVisible(el) {
  if (!(el instanceof HTMLElement)) return;

  scrollElementIntoContainerView(el, tableScrollable);
  scrollWindowToMatrixCell(el);
  scrollMatrixCellHorizontal(el);
}

function focusCell(state, rowType, idx) {
  const arr = rowType === "day" ? state.dayInputs : state.nightInputs;
  const el = arr[idx];
  if (!el || el.disabled) return false;
  focusInputWithoutAutoScroll(el);
  ensureMatrixCellVisible(el);
  if (typeof el.select === "function") el.select();
  return true;
}

function focusHorizontal(state, rowType, startIdx, step) {
  let i = startIdx;
  while (i >= 0 && i < daysInMonth) {
    if (focusCell(state, rowType, i)) return;
    i += step;
  }
}

function matrixRowIndex(memberIndex, rowType) {
  return memberIndex * 2 + (rowType === "night" ? 1 : 0);
}

function getMatrixRowContext(rowIndex) {
  if (!Number.isInteger(rowIndex) || rowIndex < 0) return null;

  const memberIndex = Math.floor(rowIndex / 2);
  const state = teamStates[memberIndex];
  if (!state) return null;

  return {
    state,
    memberIndex,
    rowType: rowIndex % 2 === 0 ? "day" : "night",
  };
}

function focusVertical(ctx, step) {
  const maxRows = teamStates.length * 2;
  let rowIndex = matrixRowIndex(ctx.memberIndex, ctx.rowType) + step;

  while (rowIndex >= 0 && rowIndex < maxRows) {
    const target = getMatrixRowContext(rowIndex);
    if (target && focusCell(target.state, target.rowType, ctx.index)) return;
    rowIndex += step;
  }
}

function setupMatrixInput(inputEl, memberIndex, rowType, index) {
  inputEl.dataset.memberIndex = String(memberIndex);
  inputEl.dataset.row = rowType;
  inputEl.dataset.idx = String(index);
}

function getMatrixInput(target) {
  if (!(target instanceof HTMLInputElement)) return null;
  if (!target.classList.contains("input-hour")) return null;
  return target;
}

function getInputContext(inputEl) {
  const memberIndex = Number(inputEl.dataset.memberIndex);
  const index = Number(inputEl.dataset.idx);
  const rowType = inputEl.dataset.row;
  const state = teamStates[memberIndex];

  if (!state || !Number.isInteger(index) || index < 0 || index >= daysInMonth) {
    return null;
  }
  if (rowType !== "day" && rowType !== "night") return null;

  return { state, memberIndex, rowType, index };
}

function handleMatrixFocusIn(e) {
  const inputEl = getMatrixInput(e.target);
  if (!inputEl) return;

  const ctx = getInputContext(inputEl);
  if (!ctx) return;

  inputEl.dataset.prev = inputEl.value ?? "";

  if (isMobileNow()) {
    mobileSelectedIdx = ctx.index;
    setMobileEmployee(ctx.state);
    updateMobileToolbar();
    focusDayColumn(ctx.index);
    scrollTableToColumn(ctx.index);
  }
}

function handleMatrixFocusOut(e) {
  const inputEl = getMatrixInput(e.target);
  if (!inputEl) return;

  const ctx = getInputContext(inputEl);
  if (!ctx) return;

  const s = String(inputEl.value ?? "").trim();

  if (ctx.rowType === "day") {
    if (s === "0" || s === "0.0" || s === "0,0") {
      inputEl.value = "";
      ctx.state.dayHours[ctx.index] = 0;
      onPersonDataChanged(ctx.state);
      return;
    }

    if (s.toUpperCase() === "О") {
      inputEl.value = "ОТ";
      inputEl.dataset.prev = "ОТ";
    }
    return;
  }

  if (s === "0" || s === "0.0" || s === "0,0") {
    inputEl.value = "";
    ctx.state.nightHours[ctx.index] = 0;
    onPersonDataChanged(ctx.state);
  }
}

function handleMatrixKeyDown(e) {
  const inputEl = getMatrixInput(e.target);
  if (!inputEl) return;
  if (e.altKey || e.ctrlKey || e.metaKey) return;

  const key = e.key;
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) return;

  const ctx = getInputContext(inputEl);
  if (!ctx) return;

  if ((key === "ArrowLeft" || key === "ArrowRight") && typeof inputEl.selectionStart === "number") {
    const start = inputEl.selectionStart ?? 0;
    const end = inputEl.selectionEnd ?? 0;
    const len = String(inputEl.value ?? "").length;

    if (key === "ArrowLeft" && !(start === 0 && end === 0)) return;
    if (key === "ArrowRight" && !(start === len && end === len)) return;
  }

  e.preventDefault();

  if (key === "ArrowLeft") focusHorizontal(ctx.state, ctx.rowType, ctx.index - 1, -1);
  else if (key === "ArrowRight") focusHorizontal(ctx.state, ctx.rowType, ctx.index + 1, 1);
  else if (key === "ArrowUp") focusVertical(ctx, -1);
  else focusVertical(ctx, 1);
}

function onPersonDataChanged(state) {
  setError(null);
  recalcPerson(state);
  scheduleSave();
}

function handleDayInput(input, state, i) {
  const weekend = isWeekendByIndex(year, month, i);

  const sanitized = sanitizeDayCellValue(input.value);
  if (sanitized !== input.value) input.value = sanitized;

  const raw = input.value;
  const hadDismissalAtCell = isDismissedLeaveType(state.leaveType[i]);

  if (!raw.trim()) {
    if (hadDismissalAtCell) {
      clearDismissalTailForState(state, i);
      applyDismissalLockToState(state, { clearFuture: false });
    }
    if (state.leaveType[i]) {
      state.leaveType[i] = null;
      unlockNightCell(state, i);
      applyDismissalLockToState(state, { clearFuture: false });
    }
    state.dayHours[i] = 0;
    input.dataset.prev = "";
    onPersonDataChanged(state);
    return;
  }

  const parsed = parseHoursOrLeave(raw);

  if (parsed.kind === "leave") {
    if (weekend && parsed.leave !== DISMISSED_LEAVE_TYPE) {
      setError("Коды отсутствия нельзя ставить на выходные (сб/вс).");
      revertToPrev(input);
      return;
    }

    if (hadDismissalAtCell && parsed.leave !== DISMISSED_LEAVE_TYPE) {
      clearDismissalTailForState(state, i);
    }
    state.leaveType[i] = parsed.leave;
    input.value = sanitizeLeaveDisplayValue(raw, parsed.leave);
    state.dayHours[i] = 0;
    state.nightHours[i] = 0;
    lockNightCell(state, i);
    input.dataset.prev = input.value;
    applyDismissalLockToState(state, { clearFuture: true });
    onPersonDataChanged(state);
    return;
  }

  if (parsed.kind === "hours") {
    if (hadDismissalAtCell) {
      clearDismissalTailForState(state, i);
      applyDismissalLockToState(state, { clearFuture: false });
    }
    if (state.leaveType[i]) {
      state.leaveType[i] = null;
      unlockNightCell(state, i);
      applyDismissalLockToState(state, { clearFuture: false });
    }

    const nextDay = sanitizeHourNumber(parsed.hours);
    const nextNight = sanitizeHourNumber(state.nightHours[i] || 0);
    const ok = clampDayTotalOrRevert({
      state,
      index: i,
      nextDay,
      nextNight,
      onRevert: () => revertToPrev(input),
    });
    if (!ok) return;

    state.dayHours[i] = nextDay;
    input.dataset.prev = input.value;
    onPersonDataChanged(state);
    return;
  }

  setError(`Некорректное значение у ${state.name}, день ${i + 1}. Допустимы числа или коды: ОТ, ОД, ОЗ, У, УД, Б, НТ, УВ.`);
}

function handleNightInput(input, state, i) {
  if (state.leaveType[i]) return;

  const sanitized = sanitizeNumericValue(input.value);
  if (sanitized !== input.value) input.value = sanitized;

  const raw = input.value;
  if (!raw.trim()) {
    state.nightHours[i] = 0;
    input.dataset.prev = "";
    onPersonDataChanged(state);
    return;
  }

  const n = parseNumberValue(raw);
  if (!Number.isFinite(n)) {
    setError(`Ночные часы у ${state.name}, день ${i + 1}: введите число или оставьте пусто.`);
    return;
  }

  const nextNight = sanitizeHourNumber(n);
  const nextDay = sanitizeHourNumber(state.dayHours[i] || 0);
  const ok = clampDayTotalOrRevert({
    state,
    index: i,
    nextDay,
    nextNight,
    onRevert: () => revertToPrev(input),
  });
  if (!ok) return;

  state.nightHours[i] = nextNight;
  input.dataset.prev = input.value;
  onPersonDataChanged(state);
}

function handleMatrixInput(e) {
  const input = getMatrixInput(e.target);
  if (!input) return;

  const ctx = getInputContext(input);
  if (!ctx) return;

  if (ctx.rowType === "day") handleDayInput(input, ctx.state, ctx.index);
  else handleNightInput(input, ctx.state, ctx.index);
}

function isTableDragIgnoredTarget(target) {
  if (!(target instanceof Element)) return true;
  return Boolean(target.closest("thead, input, textarea, select, button, a, label"));
}

function startTableDrag(e) {
  if (!tableScrollable) return;
  if (e.button !== 0 || e.pointerType === "touch") return;
  if (isTableDragIgnoredTarget(e.target)) return;

  tableDragState = {
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    startScrollLeft: tableScrollable.scrollLeft,
    hasMoved: false,
  };

  tableScrollable.setPointerCapture?.(e.pointerId);
}

function moveTableDrag(e) {
  if (!tableScrollable || !tableDragState || tableDragState.pointerId !== e.pointerId) return;

  const dx = e.clientX - tableDragState.startX;
  const dy = e.clientY - tableDragState.startY;

  if (!tableDragState.hasMoved) {
    if (Math.abs(dx) < TABLE_DRAG_THRESHOLD_PX && Math.abs(dy) < TABLE_DRAG_THRESHOLD_PX) return;
    tableDragState.hasMoved = true;
    tableScrollable.classList.add("is-dragging");
  }

  tableScrollable.scrollLeft = tableDragState.startScrollLeft - dx;
  requestHorizontalScrollStateSync();
  e.preventDefault();
}

function endTableDrag(e) {
  if (!tableScrollable || !tableDragState) return;
  if (e?.pointerId !== undefined && tableDragState.pointerId !== e.pointerId) return;

  tableScrollable.releasePointerCapture?.(tableDragState.pointerId);
  tableScrollable.classList.remove("is-dragging");
  tableDragState = null;
}

function createDayInput(state, i, memberIndex) {
  const td = document.createElement("td");
  td.dataset.dayIndex = String(i);

  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "text";
  input.className = "input-hour";
  input.autocapitalize = "characters";
  input.spellcheck = false;
  setupMatrixInput(input, memberIndex, "day", i);

  td.appendChild(input);
  state.dayInputs.push(input);
  columnCells[i].push(td);

  return td;
}

function createNightInput(state, i, memberIndex) {
  const td = document.createElement("td");
  td.className = "night-cell";
  td.dataset.dayIndex = String(i);

  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "decimal";
  input.className = "input-hour";
  input.spellcheck = false;
  setupMatrixInput(input, memberIndex, "night", i);

  td.appendChild(input);
  state.nightInputs.push(input);
  columnCells[i].push(td);

  return td;
}

function buildTable() {
  headerRow.innerHTML = "";
  matrixBody.innerHTML = "";
  headerCells = [];
  columnCells = Array.from({ length: daysInMonth }, () => []);
  focusedDayIndex = null;

  const labelTh = document.createElement("th");
  labelTh.className = "label-cell";
  labelTh.textContent = "Сотрудник";
  headerRow.appendChild(labelTh);

  for (let i = 0; i < daysInMonth; i++) {
    const th = createHeaderCell(i);
    if (isWeekendByIndex(year, month, i)) th.classList.add("weekend-col");
    headerRow.appendChild(th);
    headerCells.push(th);
    columnCells[i].push(th);
  }

  const summaryTh = document.createElement("th");
  summaryTh.className = "summary-head";
  summaryTh.innerHTML = 'Итоги<br><span class="th-dow">1-я пол. / месяц</span>';
  headerRow.appendChild(summaryTh);

  const fragment = document.createDocumentFragment();

  for (let idx = 0; idx < teamStates.length; idx++) {
    const state = teamStates[idx];

    state.dayInputs = [];
    state.nightInputs = [];
    state.summaryEl = null;

    const dayTr = document.createElement("tr");
    const nightTr = document.createElement("tr");

    state.dayRowEl = dayTr;
    state.nightRowEl = nightTr;

    dayTr.classList.add("employee-day-row");
    nightTr.classList.add("employee-night-row");

    if (idx < teamStates.length - 1) {
      nightTr.classList.add("person-divider");
    }

    state.labelCell = makeLabelCell(state);
    dayTr.appendChild(state.labelCell);

    for (let i = 0; i < daysInMonth; i++) {
      dayTr.appendChild(createDayInput(state, i, idx));
    }

    const summaryTd = document.createElement("td");
    summaryTd.className = "summary-cell";
    summaryTd.rowSpan = 2;
    state.summaryEl = summaryTd;
    dayTr.appendChild(summaryTd);

    for (let i = 0; i < daysInMonth; i++) {
      nightTr.appendChild(createNightInput(state, i, idx));
    }

    fragment.append(dayTr, nightTr);
  }

  matrixBody.appendChild(fragment);
  applyStateToDom();
  if (isMobileNow()) {
    setMobileEmployee(teamStates[0]);
  }
}

function applyStateToDom() {
  for (const state of teamStates) {
    for (let i = 0; i < daysInMonth; i++) {
      const leave = normalizeLeaveTypeLegacy(state.leaveType[i]);

      if (leave) {
        state.dayInputs[i].value = leaveTypeToCode(leave, "ОТ");
        state.dayHours[i] = 0;
        state.nightHours[i] = 0;
        lockNightCell(state, i);
      } else {
        state.dayInputs[i].value = formatHourForInput(state.dayHours[i]);
        unlockNightCell(state, i);
        state.nightInputs[i].value = formatHourForInput(state.nightHours[i]);
      }

      state.dayInputs[i].dataset.prev = state.dayInputs[i].value ?? "";
      state.nightInputs[i].dataset.prev = state.nightInputs[i].value ?? "";
    }

    applyDismissalLockToState(state, { clearFuture: true });
  }

  for (let i = 0; i < daysInMonth; i++) {
    updateDayMarkClasses(i);
  }

  renderSharedSummary();
  recalcAllPeople();
}

function updateDayMarkClasses(index) {
  const cells = columnCells[index] ?? [];
  for (const el of cells) {
    el.classList.remove("holiday-col", "transferred-col", "short-col", "weekend-col");
    if (isWeekendByIndex(year, month, index)) el.classList.add("weekend-col");

    if (sharedHoliday[index]) el.classList.add("holiday-col");
    else if (sharedTransferredOff[index]) el.classList.add("transferred-col");
    else if (sharedShortDay[index]) el.classList.add("short-col");
  }
}

function countLeaves(state) {
  let ot = 0;
  let sick = 0;
  let nt = 0;
  let other = 0;

  for (let i = 0; i < daysInMonth; i++) {
    const lt = normalizeLeaveTypeLegacy(state.leaveType[i]);
    if (!lt) continue;
    if (lt === DISMISSED_LEAVE_TYPE) continue;

    if (lt === "vac_paid") ot++;
    else if (lt === "sick") sick++;
    else if (lt === NOT_EMPLOYED_LEAVE_TYPE) nt++;
    else other++;
  }

  return { ot, sick, nt, other };
}

function calendarNormHoursForBase(baseDayHours) {
  let weekdays = 0;
  let holidayWeekdays = 0;
  let transferredWeekdays = 0;
  let shortWeekdays = 0;

  for (let i = 0; i < daysInMonth; i++) {
    if (isWeekendByIndex(year, month, i)) continue;
    weekdays++;

    if (sharedHoliday[i]) holidayWeekdays++;
    else if (sharedTransferredOff[i]) transferredWeekdays++;
    else if (sharedShortDay[i]) shortWeekdays++;
  }

  return (
    weekdays * baseDayHours -
    holidayWeekdays * baseDayHours -
    transferredWeekdays * baseDayHours -
    shortWeekdays * SHORT_DAY_REDUCTION_HOURS
  );
}

function calendarFirstHalfNormForBase(baseDayHours) {
  const endIdx = Math.min(14, daysInMonth - 1);
  let weekdays = 0;
  let holidayWeekdays = 0;
  let transferredWeekdays = 0;
  let shortWeekdays = 0;

  for (let i = 0; i <= endIdx; i++) {
    if (isWeekendByIndex(year, month, i)) continue;
    weekdays++;

    if (sharedHoliday[i]) holidayWeekdays++;
    else if (sharedTransferredOff[i]) transferredWeekdays++;
    else if (sharedShortDay[i]) shortWeekdays++;
  }

  return (
    weekdays * baseDayHours -
    holidayWeekdays * baseDayHours -
    transferredWeekdays * baseDayHours -
    shortWeekdays * SHORT_DAY_REDUCTION_HOURS
  );
}

function personalNormHours(state) {
  const baseDayHours = getBaseDayHours(state.gender, state.branch);
  const monthNorm = calendarNormHoursForBase(baseDayHours);

  let effectiveLeaveHours = 0;
  for (let i = 0; i < daysInMonth; i++) {
    if (!isNormAffectingLeaveType(state.leaveType[i])) continue;
    effectiveLeaveHours += normHoursForDay(i, baseDayHours);
  }

  const personalNorm = Math.max(0, monthNorm - effectiveLeaveHours);
  return { monthNorm, personalNorm };
}

function firstHalfStats(state) {
  const baseDayHours = getBaseDayHours(state.gender, state.branch);
  const endIdx = Math.min(14, daysInMonth - 1);

  let weekdays = 0;
  let holidayWeekdays = 0;
  let transferredWeekdays = 0;
  let shortWeekdays = 0;
  let leaveEffectiveHours = 0;

  for (let i = 0; i <= endIdx; i++) {
    if (isWeekendByIndex(year, month, i)) continue;
    weekdays++;

    if (sharedHoliday[i]) holidayWeekdays++;
    else if (sharedTransferredOff[i]) transferredWeekdays++;
    else if (sharedShortDay[i]) shortWeekdays++;

    if (isNormAffectingLeaveType(state.leaveType[i])) {
      leaveEffectiveHours += normHoursForDay(i, baseDayHours);
    }
  }

  const monthHalfNorm =
    weekdays * baseDayHours -
    holidayWeekdays * baseDayHours -
    transferredWeekdays * baseDayHours -
    shortWeekdays * SHORT_DAY_REDUCTION_HOURS;

  const personalHalfNorm = Math.max(0, monthHalfNorm - leaveEffectiveHours);
  const workedFH = sumRange(state.dayHours, 0, endIdx) + sumRange(state.nightHours, 0, endIdx);

  return { personalHalfNorm, workedFH };
}

function updatePersonSummary(state) {
  const totalDay = sumArr(state.dayHours);
  const totalNight = sumArr(state.nightHours);
  const workedTotal = totalDay + totalNight;

  const { personalNorm } = personalNormHours(state);
  const { personalHalfNorm, workedFH } = firstHalfStats(state);
  const leaves = countLeaves(state);

  const overtime = workedTotal - personalNorm;
  const hasOvertime = overtime > 0.0001;
  const hasMinorOvertime = overtime > 0.0001 && overtime <= MINOR_OVERTIME_LIMIT_HOURS + 0.0001;
  const hasMajorOvertime = overtime > MINOR_OVERTIME_LIMIT_HOURS + 0.0001;

  state.dayRowEl?.classList.toggle("overtime-row", hasOvertime);
  state.dayRowEl?.classList.toggle("overtime-row-top", hasOvertime);
  state.dayRowEl?.classList.toggle("overtime-row-minor", hasMinorOvertime);
  state.dayRowEl?.classList.toggle("overtime-row-major", hasMajorOvertime);

  state.nightRowEl?.classList.toggle("overtime-row", hasOvertime);
  state.nightRowEl?.classList.toggle("overtime-row-bottom", hasOvertime);
  state.nightRowEl?.classList.toggle("overtime-row-minor", hasMinorOvertime);
  state.nightRowEl?.classList.toggle("overtime-row-major", hasMajorOvertime);

  state.labelCell?.classList.toggle("is-overtime", hasMajorOvertime);
  state.labelCell?.classList.toggle("is-overtime-minor", hasMinorOvertime);
  state.summaryEl?.classList.toggle("is-overtime", hasMajorOvertime);
  state.summaryEl?.classList.toggle("is-overtime-minor", hasMinorOvertime);

  if (state.overtimeBadge) {
    state.overtimeBadge.textContent = hasOvertime ? `+${fmtHours(overtime)} ч` : "";
    state.overtimeBadge.classList.toggle("is-hidden", !hasOvertime);
    state.overtimeBadge.classList.toggle("is-minor", hasMinorOvertime);
    state.overtimeBadge.classList.toggle("is-major", hasMajorOvertime);
  }

  if (!state.summaryEl) return;

  state.summaryEl.innerHTML = `
    <div class="summary-box">
      <div class="summary-main">
        <span>Часы</span>
        <strong>${fmtHours(workedFH)} / ${fmtHours(workedTotal)}</strong>
      </div>
      <div class="summary-line">
        <span>Норма</span>
        <strong>${fmtHours(personalHalfNorm)} / ${fmtHours(personalNorm)}</strong>
      </div>
      <div class="summary-line">
        <span>День / ночь</span>
        <strong>${fmtHours(totalDay)} / ${fmtHours(totalNight)}</strong>
      </div>
      <div class="summary-line muted">
        <span>ОТ / Б / НТ / проч.</span>
        <strong>${leaves.ot} / ${leaves.sick} / ${leaves.nt} / ${leaves.other}</strong>
      </div>
    </div>
  `;
}

function getReferenceBaseHours() {
  return DEFAULT_DAY_HOURS;
}

function renderSharedSummary() {
  const deptName = managedDepartment?.name ? ` • ${managedDepartment.name}` : "";
  monthYearDisplay.textContent = `${monthNames[month]} ${year}${deptName}`;
  teamCountEl.textContent = String(teamStates.length);

  const baseHours = getReferenceBaseHours();
  normMonthEl.textContent = fmtHours(calendarNormHoursForBase(baseHours));
  normFirstHalfEl.textContent = fmtHours(calendarFirstHalfNormForBase(baseHours));
}

function recalcPerson(state) {
  updatePersonSummary(state);
}

function recalcAllPeople() {
  for (const state of teamStates) {
    updatePersonSummary(state);
  }
}

function recalcAll() {
  setError(null);
  renderSharedSummary();
  recalcAllPeople();
}

function initCurrentDaySelection() {
  const now = new Date();

  if (now.getFullYear() === year && now.getMonth() === month) {
    const dayIdx = Math.min(now.getDate() - 1, daysInMonth - 1);
    if (dayIdx >= 0) {
      requestAnimationFrame(() => {
        if (isMobileNow()) {
          setMobileDay(dayIdx, { scroll: false });
        } else {
          mobileSelectedIdx = dayIdx;
          focusDayColumn(dayIdx);
          updateMobileToolbar();
          scrollTableToColumn(dayIdx);
        }
      });
    }
  } else if (isMobileNow()) {
    requestAnimationFrame(() => setMobileDay(0, { scroll: false }));
  } else {
    requestAnimationFrame(() => setMobileDay(0, { scroll: false }));
  }
}

async function exportCurrentMonthToExcel() {
  setSaveStatus("Готовлю Excel…", "busy");
  setError(null);

  try {
   await exportDepartmentTimesheetXlsx({
    year,
    month,
    department: managedDepartment,
    states: teamStates,
    sharedHoliday,
    sharedTransferredOff,
    sharedShortDay,
    templateUrl: new URL("./templates/tabel-template.xlsx", import.meta.url).href,
  });

    setSaveStatus("Excel выгружен", "ok");
  } catch (e) {
    setSaveStatus("Ошибка выгрузки", "err");
    setError(e?.message || "Не удалось выгрузить Excel.");
  }
}

function buildInviteUrl(token) {
  const url = new URL("login.html", window.location.href);
  url.searchParams.set("mode", "signup");
  url.searchParams.set("invite", String(token ?? "").trim());
  url.searchParams.set("next", "profile.html");
  return url.toString();
}

async function copyText(value) {
  const textValue = String(value ?? "");

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(textValue);
    return;
  }

  const input = document.createElement("input");
  input.value = textValue;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

function mapInviteError(error) {
  const message = String(error?.message || "");

  if (message.includes("ACCESS_DENIED")) return "Недостаточно прав для создания приглашения в этот отдел.";
  if (message.includes("DEPARTMENT_NOT_FOUND")) return "Отдел не найден.";
  if (message.includes("owner_create_department_invite") || message.includes("department_invites") || message.includes("gen_random_bytes")) {
    return "В базе нужно запустить supabase-sql/006_fix_invite_permissions_and_pgcrypto.sql.";
  }

  return message || "Не удалось создать приглашение.";
}

function mapNotificationError(error) {
  const message = String(error?.message || "");

  if (message.includes("ACCESS_DENIED")) return "Табель сохранён, но уведомление не отправлено: недостаточно прав.";
  if (message.includes("DEPARTMENT_NOT_FOUND")) return "Табель сохранён, но уведомление не отправлено: отдел не найден.";
  if (message.includes("RECIPIENT_NOT_IN_DEPARTMENT")) {
    return "Табель сохранён, но один из получателей больше не состоит в этом отделе. Обновите страницу.";
  }
  if (
    message.includes("notify_personal_timesheet_changes") ||
    message.includes("notify_department_timesheet_saved") ||
    message.includes("user_notifications") ||
    message.includes("Could not find the function") ||
    message.includes("schema cache")
  ) {
    return "Табель сохранён, но для персональных уведомлений нужно запустить supabase-sql/012_personal_timesheet_notifications.sql.";
  }

  return "Табель сохранён, но уведомление не отправлено.";
}

function mapPushNotificationError(error) {
  const message = String(error?.message || error?.context?.message || "");

  if (
    message.includes("FunctionsHttpError") ||
    message.includes("send-push-notifications") ||
    message.includes("Edge Function") ||
    message.includes("not found")
  ) {
    return "Уведомление на сайте отправлено, но push ещё не настроен: нужно задеплоить Supabase Edge Function send-push-notifications.";
  }

  if (message.includes("push_sent_at") || message.includes("push_subscriptions")) {
    return "Уведомление на сайте отправлено, но для push нужно запустить SQL-файлы 010 и 011.";
  }

  if (message.includes("ACCESS_DENIED")) {
    return "Уведомление на сайте отправлено, но push не отправлен: недостаточно прав.";
  }

  return "Уведомление на сайте отправлено, но push на телефон не отправился.";
}

async function createCurrentDepartmentInvite() {
  if (!managedDepartment?.key) {
    setError("Не найден текущий отдел для приглашения.");
    return;
  }

  try {
    setSaveStatus("Создаю приглашение…", "busy");
    setError(null);
    if (createInviteBtn) createInviteBtn.disabled = true;

    const invite = await ownerCreateDepartmentInvite({
      departmentKey: managedDepartment.key,
      expiresInDays: 14,
      maxUses: 20,
    });

    if (!invite?.token) {
      throw new Error("Не удалось получить токен приглашения.");
    }

    const link = buildInviteUrl(invite.token);
    if (inviteLinkInput) inviteLinkInput.value = link;
    inviteBox?.classList.remove("hidden");
    await copyText(link).catch(() => {});
    setSaveStatus("Ссылка приглашения создана", "ok");
  } catch (error) {
    setSaveStatus("Ошибка приглашения", "err");
    setError(mapInviteError(error));
  } finally {
    if (createInviteBtn) createInviteBtn.disabled = false;
  }
}


async function doSaveAll({ notify = false } = {}) {
  setSaveStatus("Сохраняю…", "busy");
  setError(null);

  try {
    if (notify && saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }

    const personalChanges = notify ? collectPersonalTimesheetChanges() : [];
    const items = currentSaveItems();
    await managedSaveManyTimesheets(items);
    lastSavedSignature = currentSignature();
    dirty = false;

    if (notify) {
      try {
        if (personalChanges.length) {
          await notifyPersonalTimesheetChanges({
            departmentKey: managedDepartment?.key,
            year,
            month,
            changes: personalChanges,
          });

          updateNotificationBaseline(personalChanges.map((item) => item.userId));
          hasPendingPersonalPush = true;
        }

        if (!personalChanges.length && !hasPendingPersonalPush) {
          setSaveStatus("Сохранено, новых изменений нет", "ok");
          return;
        }

        try {
          await sendPushNotifications({
            departmentKey: managedDepartment?.key,
            type: "personal_timesheet_changed",
          });
          hasPendingPersonalPush = false;
        } catch (pushError) {
          setSaveStatus(
            personalChanges.length
              ? `Сохранено для ${personalChanges.length}, push не отправлен`
              : "Сохранено, push не отправлен",
            "err"
          );
          setError(mapPushNotificationError(pushError));
          return;
        }

        setSaveStatus(
          personalChanges.length
            ? `Сохранено и отправлено: ${personalChanges.length}`
            : "Сохранено, новых изменений нет",
          "ok"
        );
        return;
      } catch (notificationError) {
        setSaveStatus("Сохранено без уведомления", "err");
        setError(mapNotificationError(notificationError));
        return;
      }
    }

    setSaveStatus(
      `Сохранено: ${new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`,
      "ok"
    );
  } catch (e) {
    setSaveStatus("Ошибка сохранения", "err");
    setError(e?.message || "Не удалось сохранить табели.");
  }
}

function scheduleSave() {
  markDirty();
  if (saveTimer) clearTimeout(saveTimer);

  saveTimer = setTimeout(async () => {
    const nextSignature = currentSignature();
    if (nextSignature === lastSavedSignature) {
      dirty = false;
      setSaveStatus("Сохранено", "ok");
      return;
    }
    await doSaveAll({ notify: false });
  }, 900);
}

async function resolveManagedDepartment() {
  currentProfile = await getMyProfile();
  const isOwner = currentProfile?.role === "owner";

  if (isOwner) {
    if (!requestedDepartmentKey) {
      location.href = "owner.html";
      return null;
    }

    const ownerDepartment = await getDepartmentByKey(requestedDepartmentKey);
    if (!ownerDepartment) {
      throw new Error("Указанный отдел не найден.");
    }

    if (backToTableLink) {
      backToTableLink.href = "owner.html";
      backToTableLink.textContent = "Все отделы";
    }

    return ownerDepartment;
  }

  const managedDepartment = await getMyManagedDepartment();

  if (backToTableLink) {
    backToTableLink.href = "table.html";
    backToTableLink.textContent = "Личный табель";
  }

  return managedDepartment;
}


async function guardManagedDepartment() {
  try {
    await requireSession();
  } catch {
    const next = requestedDepartmentKey
      ? `admin.html?department=${encodeURIComponent(requestedDepartmentKey)}`
      : "admin.html";
    location.href = `login.html?next=${encodeURIComponent(next)}`;
    return false;
  }

  managedDepartment = await resolveManagedDepartment();
  if (!managedDepartment) {
    setError("Доступ запрещён. У вас нет прав на этот общий табель.");
    return false;
  }

  return true;
}

async function loadCurrentMonth() {
  setSaveStatus("Загружаю…", "busy");

  try {
    if (!managedDepartment?.key) {
      managedDepartment = await resolveManagedDepartment();
    }
    if (!managedDepartment?.key) {
      throw new Error("Не найден доступный отдел.");
    }

    const members = await listManagedDepartmentMembers(managedDepartment.key);
    resetMonthArrays(members);

    const userIds = teamStates.map((state) => state.userId);
    const [payloads, previousRows] = await Promise.all([
      Promise.all(teamStates.map((state) => managedLoadTimesheet(state.userId, year, month))),
      managedListTimesheetsBefore(userIds, year, month),
    ]);

    const payloadsByUserId = new Map();
    for (let i = 0; i < teamStates.length; i++) {
      payloadsByUserId.set(teamStates[i].userId, payloads[i]);
    }

    applyDismissalsBeforeMonth(previousRows);
    applyLoadedPayloads(payloadsByUserId);
    buildTable();
    syncTopTableScrollWidth();
    syncHorizontalScrollState();

    lastSavedSignature = currentSignature();
    resetNotificationBaseline();
    hasPendingPersonalPush = false;
    dirty = false;
    setSaveStatus("Сохранено", "ok");

    initCurrentDaySelection();
  } catch (e) {
    setSaveStatus("Ошибка загрузки", "err");
    setError(e?.message || "Не удалось загрузить общий табель.");
  }
}

// === Mobile toolbar events ===
mPrevDay?.addEventListener("click", () => setMobileDay(mobileSelectedIdx - 1));
mNextDay?.addEventListener("click", () => setMobileDay(mobileSelectedIdx + 1));

mToday?.addEventListener("click", () => {
  const now = new Date();
  if (now.getFullYear() === year && now.getMonth() === month) {
    setMobileDay(now.getDate() - 1);
  }
});

mHolidayBtn?.addEventListener("click", () => {
  const idx = mobileSelectedIdx;
  if (idx < 0 || idx >= daysInMonth) return;

  const changed = setSharedDayMark(idx, sharedHoliday[idx] ? null : "holiday");

  updateDayMarkClasses(idx);
  renderSharedSummary();
  recalcAllPeople();
  if (changed) scheduleSave();
  updateMobileToolbar();
});

mTransferredBtn?.addEventListener("click", () => {
  const idx = mobileSelectedIdx;
  if (idx < 0 || idx >= daysInMonth) return;

  const changed = setSharedDayMark(idx, sharedTransferredOff[idx] ? null : "transferred");

  updateDayMarkClasses(idx);
  renderSharedSummary();
  recalcAllPeople();
  if (changed) scheduleSave();
  updateMobileToolbar();
});

mShortBtn?.addEventListener("click", () => {
  const idx = mobileSelectedIdx;
  if (idx < 0 || idx >= daysInMonth) return;

  const changed = setSharedDayMark(idx, sharedShortDay[idx] ? null : "short");

  updateDayMarkClasses(idx);
  renderSharedSummary();
  recalcAllPeople();
  if (changed) scheduleSave();
  updateMobileToolbar();
});

logoutBtn?.addEventListener("click", async () => {
  try {
    await signOut();
  } finally {
    location.href = "login.html";
  }
});

saveBtn?.addEventListener("click", async () => {
  await doSaveAll({ notify: true });
});

exportExcelBtn?.addEventListener("click", async () => {
  await exportCurrentMonthToExcel();
});

createInviteBtn?.addEventListener("click", async () => {
  await createCurrentDepartmentInvite();
});

copyInviteBtn?.addEventListener("click", async () => {
  const value = String(inviteLinkInput?.value || "").trim();
  if (!value) return;

  try {
    await copyText(value);
    setSaveStatus("Ссылка скопирована", "ok");
  } catch (error) {
    setSaveStatus("Ошибка копирования", "err");
    setError(error?.message || "Не удалось скопировать ссылку.");
  }
});

reloadBtn?.addEventListener("click", async () => {
  await loadCurrentMonth();
});

tableScrollable?.addEventListener("scroll", () => {
  requestHorizontalScrollStateSync();
}, { passive: true });

topTableScroll?.addEventListener("scroll", () => {
  syncTableScrollFromTop();
}, { passive: true });

tableScrollable?.addEventListener("pointerdown", startTableDrag);
tableScrollable?.addEventListener("pointermove", moveTableDrag);
tableScrollable?.addEventListener("pointerup", endTableDrag);
tableScrollable?.addEventListener("pointercancel", endTableDrag);
tableScrollable?.addEventListener("lostpointercapture", endTableDrag);

matrixBody?.addEventListener("focusin", handleMatrixFocusIn);
matrixBody?.addEventListener("focusout", handleMatrixFocusOut);
matrixBody?.addEventListener("input", handleMatrixInput);
matrixBody?.addEventListener("keydown", handleMatrixKeyDown);

monthSelect?.addEventListener("change", async () => {
  month = Number(monthSelect.value);
  updateUrlForMonth();
  await loadCurrentMonth();
  initCurrentDaySelection();
});

yearSelect?.addEventListener("change", async () => {
  year = Number(yearSelect.value);
  updateUrlForMonth();
  await loadCurrentMonth();
  initCurrentDaySelection();
});


window.addEventListener("resize", () => {
  if (resizeRaf) return;

  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = 0;

    if (isMobileNow()) {
      setMobileDay(mobileSelectedIdx, { scroll: false });
    } else {
      clearFocusColumn();
    }
    syncTopTableScrollWidth();
  });
});

window.addEventListener("beforeunload", (e) => {
  if (!dirty) return;
  e.preventDefault();
  e.returnValue = "";
});

(async () => {
  try {
    setError(null);
    const ok = await guardManagedDepartment();
    if (!ok) return;

    startPresenceHeartbeat("Общий табель");

    setFromQueryOrNow();
    fillYearOptions();
    updateUrlForMonth();
    await loadCurrentMonth();
    initCurrentDaySelection();
  } catch (e) {
    setError(e?.message || "Ошибка админки.");
    setSaveStatus("Ошибка", "err");
  }
})();

