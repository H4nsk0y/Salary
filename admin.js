// =========================
// FILE: /admin.js
// =========================
import { requireSession, signOut } from "./auth.js";
import {
  getMyManagedDepartment,
  getMyProfile,
  getDepartmentByKey,
  listManagedDepartmentMembers,
  managedLoadTimesheet,
  managedSaveManyTimesheets,
} from "./db.js";
import { startPresenceHeartbeat } from "./presence.js";

import { exportDepartmentTimesheetXlsx } from "./excelExport.js";

document.body.classList.add("is-loaded");

const DEFAULT_DAY_HOURS = 8;
const FEMALE_DAY_HOURS = 7.2;
const MAX_HOURS_PER_DAY = 24;
const SHORT_DAY_REDUCTION_HOURS = 1;

const monthNames = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
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

let dirty = false;
let lastSavedSignature = "";
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
  const labelWidth = 190;
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
  if (!isMobileNow()) return;
  const idx = mobileSelectedIdx;
  if (idx < 0 || idx >= daysInMonth) return;

  const d = new Date(year, month, idx + 1);
  mDayLabel.textContent = `${idx + 1} · ${DOW_SHORT[d.getDay()]}`;
  mHolidayBtn?.classList.toggle("is-active", Boolean(sharedHoliday[idx]));
  mTransferredBtn?.classList.toggle("is-active", Boolean(sharedTransferredOff[idx]));
  mShortBtn?.classList.toggle("is-active", Boolean(sharedShortDay[idx]));
}

function setMobileDay(dayIdx0) {
  if (dayIdx0 < 0) dayIdx0 = 0;
  if (dayIdx0 >= daysInMonth) dayIdx0 = daysInMonth - 1;

  mobileSelectedIdx = dayIdx0;
  focusDayColumn(dayIdx0);
  scrollTableToColumn(dayIdx0);
  updateMobileToolbar();
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

function getBaseDayHours(gender) {
  return gender === "female" ? FEMALE_DAY_HOURS : DEFAULT_DAY_HOURS;
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
    .replaceAll("Y", "У");

  s = s.replace(/\s+/g, "");
  const letters = s.replace(/[^ОТБДЗУЛ]/g, "");

  if (letters) {
    if (letters.includes("Б")) return "Б";
    if (letters.startsWith("О")) {
      const second = letters[1] || "";
      if (second === "Т") return "ОТ";
      if (second === "Д") return "ОД";
      if (second === "З") return "ОЗ";
      return "О";
    }
    if (letters.startsWith("У")) {
      const second = letters[1] || "";
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
    .replaceAll("L", "Л");

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
    position: member?.position ?? "",
    tabNumber: member?.tab_number ?? "",
    dayHours: new Array(daysInMonth).fill(0),
    nightHours: new Array(daysInMonth).fill(0),
    leaveType: new Array(daysInMonth).fill(null),
    dayInputs: [],
    nightInputs: [],
    summaryEl: null,
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

function chooseSharedMarkSource(payloadsByUserId) {
  for (const payload of payloadsByUserId.values()) {
    if (hasSharedMarks(payload)) return payload;
  }
  return null;
}

function applyLoadedPayloads(payloadsByUserId) {
  const sharedSource = chooseSharedMarkSource(payloadsByUserId);

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
  }
}

function makeLabelCell(name) {
  const td = document.createElement("td");
  td.className = "label-cell";
  td.rowSpan = 2;

  const main = document.createElement("span");
  main.className = "label-main";
  main.textContent = name;

  const sub = document.createElement("span");
  sub.className = "label-sub";
  sub.textContent = "День / Ночь";

  td.append(main, sub);
  return td;
}

function setSharedDayMarkByCycle(dayIndex, clickCount) {
  if (clickCount === 1) {
    sharedHoliday[dayIndex] = true;
    sharedTransferredOff[dayIndex] = false;
    sharedShortDay[dayIndex] = false;
    return;
  }

  if (clickCount === 2) {
    sharedHoliday[dayIndex] = false;
    sharedTransferredOff[dayIndex] = true;
    sharedShortDay[dayIndex] = false;
    return;
  }

  sharedHoliday[dayIndex] = false;
  sharedTransferredOff[dayIndex] = false;
  sharedShortDay[dayIndex] = true;
}

function clearSharedDayMark(dayIndex) {
  sharedHoliday[dayIndex] = false;
  sharedTransferredOff[dayIndex] = false;
  sharedShortDay[dayIndex] = false;
}

function createHeaderCell(dayIndex) {
  const th = document.createElement("th");
  th.dataset.dayIndex = String(dayIndex);

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

  th.addEventListener("click", () => {
    if (isMobileNow()) setMobileDay(dayIndex);

    clickCount += 1;
    if (clickTimer) clearTimeout(clickTimer);

    clickTimer = setTimeout(() => {
      setSharedDayMarkByCycle(dayIndex, clickCount >= 3 ? 3 : clickCount);
      clickCount = 0;
      clickTimer = null;

      updateDayMarkClasses(dayIndex);
      renderSharedSummary();
      recalcAllPeople();
      scheduleSave();
      updateMobileToolbar();
    }, 320);
  });

  th.addEventListener("contextmenu", (e) => {
    e.preventDefault();

    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    clickCount = 0;

    if (isMobileNow()) setMobileDay(dayIndex);

    clearSharedDayMark(dayIndex);
    updateDayMarkClasses(dayIndex);
    renderSharedSummary();
    recalcAllPeople();
    scheduleSave();
    updateMobileToolbar();
  });

  return th;
}

function currentPayloadForState(state) {
  return {
    v: 5,
    year,
    month,
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

function lockNightCell(state, i) {
  const el = state.nightInputs[i];
  if (!el) return;
  el.value = "";
  el.disabled = true;
  el.classList.add("opacity-50", "cursor-not-allowed");
}

function unlockNightCell(state, i) {
  const el = state.nightInputs[i];
  if (!el) return;
  el.disabled = false;
  el.classList.remove("opacity-50", "cursor-not-allowed");
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

function focusCell(state, rowType, idx) {
  const arr = rowType === "day" ? state.dayInputs : state.nightInputs;
  const el = arr[idx];
  if (!el || el.disabled) return false;
  el.focus();
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

  return { state, rowType, index };
}

function handleMatrixFocusIn(e) {
  const inputEl = getMatrixInput(e.target);
  if (!inputEl) return;

  const ctx = getInputContext(inputEl);
  if (!ctx) return;

  inputEl.dataset.prev = inputEl.value ?? "";

  if (isMobileNow()) {
    mobileSelectedIdx = ctx.index;
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
  else focusCell(ctx.state, ctx.rowType === "day" ? "night" : "day", ctx.index);
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

  if (!raw.trim()) {
    if (state.leaveType[i]) {
      state.leaveType[i] = null;
      unlockNightCell(state, i);
    }
    state.dayHours[i] = 0;
    input.dataset.prev = "";
    onPersonDataChanged(state);
    return;
  }

  const parsed = parseHoursOrLeave(raw);

  if (parsed.kind === "leave") {
    if (weekend) {
      setError("Коды отсутствия нельзя ставить на выходные (сб/вс).");
      revertToPrev(input);
      return;
    }

    state.leaveType[i] = parsed.leave;
    input.value = sanitizeLeaveDisplayValue(raw, parsed.leave);
    state.dayHours[i] = 0;
    state.nightHours[i] = 0;
    lockNightCell(state, i);
    input.dataset.prev = input.value;
    onPersonDataChanged(state);
    return;
  }

  if (parsed.kind === "hours") {
    if (state.leaveType[i]) {
      state.leaveType[i] = null;
      unlockNightCell(state, i);
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

  setError(`Некорректное значение у ${state.name}, день ${i + 1}. Допустимы числа или коды: ОТ, ОД, ОЗ, У, УД, Б.`);
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
  return Boolean(target.closest("input, textarea, select, button, a, label"));
}

function startTableDrag(e) {
  if (!tableScrollable) return;
  if (e.button !== 0 || e.pointerType === "touch") return;
  if (isTableDragIgnoredTarget(e.target)) return;

  tableDragState = {
    pointerId: e.pointerId,
    startX: e.clientX,
    startScrollLeft: tableScrollable.scrollLeft,
  };

  tableScrollable.classList.add("is-dragging");
  tableScrollable.setPointerCapture?.(e.pointerId);
  e.preventDefault();
}

function moveTableDrag(e) {
  if (!tableScrollable || !tableDragState || tableDragState.pointerId !== e.pointerId) return;

  const dx = e.clientX - tableDragState.startX;
  tableScrollable.scrollLeft = tableDragState.startScrollLeft - dx;
  requestHorizontalScrollStateSync();
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

    dayTr.appendChild(makeLabelCell(state.name));

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
  let other = 0;

  for (let i = 0; i < daysInMonth; i++) {
    const lt = normalizeLeaveTypeLegacy(state.leaveType[i]);
    if (!lt) continue;

    if (lt === "vac_paid") ot++;
    else if (lt === "sick") sick++;
    else other++;
  }

  return { ot, sick, other };
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
  const baseDayHours = getBaseDayHours(state.gender);
  const monthNorm = calendarNormHoursForBase(baseDayHours);

  let effectiveLeaveDays = 0;
  for (let i = 0; i < daysInMonth; i++) {
    const lt = normalizeLeaveTypeLegacy(state.leaveType[i]);
    if (!lt) continue;
    if (!sharedHoliday[i] && !sharedTransferredOff[i]) effectiveLeaveDays++;
  }

  const personalNorm = monthNorm - effectiveLeaveDays * baseDayHours;
  return { monthNorm, personalNorm };
}

function firstHalfStats(state) {
  const baseDayHours = getBaseDayHours(state.gender);
  const endIdx = Math.min(14, daysInMonth - 1);

  let weekdays = 0;
  let holidayWeekdays = 0;
  let transferredWeekdays = 0;
  let shortWeekdays = 0;
  let leaveEffectiveDays = 0;

  for (let i = 0; i <= endIdx; i++) {
    if (isWeekendByIndex(year, month, i)) continue;
    weekdays++;

    if (sharedHoliday[i]) holidayWeekdays++;
    else if (sharedTransferredOff[i]) transferredWeekdays++;
    else if (sharedShortDay[i]) shortWeekdays++;

    const lt = normalizeLeaveTypeLegacy(state.leaveType[i]);
    if (lt && !sharedHoliday[i] && !sharedTransferredOff[i]) leaveEffectiveDays++;
  }

  const monthHalfNorm =
    weekdays * baseDayHours -
    holidayWeekdays * baseDayHours -
    transferredWeekdays * baseDayHours -
    shortWeekdays * SHORT_DAY_REDUCTION_HOURS;

  const personalHalfNorm = monthHalfNorm - leaveEffectiveDays * baseDayHours;
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

  state.dayRowEl?.classList.toggle("overtime-row", hasOvertime);
  state.dayRowEl?.classList.toggle("overtime-row-top", hasOvertime);

  state.nightRowEl?.classList.toggle("overtime-row", hasOvertime);
  state.nightRowEl?.classList.toggle("overtime-row-bottom", hasOvertime);

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
        <span>ОТ / Б / проч.</span>
        <strong>${leaves.ot} / ${leaves.sick} / ${leaves.other}</strong>
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
          setMobileDay(dayIdx);
        } else {
          clearFocusColumn();
          scrollTableToColumn(dayIdx);
        }
      });
    }
  } else if (isMobileNow()) {
    requestAnimationFrame(() => setMobileDay(0));
  } else {
    clearFocusColumn();
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


async function doSaveAll() {
  setSaveStatus("Сохраняю…", "busy");

  try {
    const items = currentSaveItems();
    await managedSaveManyTimesheets(items);
    lastSavedSignature = currentSignature();
    dirty = false;
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
    await doSaveAll();
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

    const payloads = await Promise.all(
      teamStates.map((state) => managedLoadTimesheet(state.userId, year, month))
    );

    const payloadsByUserId = new Map();
    for (let i = 0; i < teamStates.length; i++) {
      payloadsByUserId.set(teamStates[i].userId, payloads[i]);
    }

    applyLoadedPayloads(payloadsByUserId);
    buildTable();
    syncTopTableScrollWidth();
    syncHorizontalScrollState();

    lastSavedSignature = currentSignature();
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

  const next = !sharedHoliday[idx];
  sharedHoliday[idx] = next;
  sharedTransferredOff[idx] = false;
  sharedShortDay[idx] = false;

  if (!next) sharedHoliday[idx] = false;

  updateDayMarkClasses(idx);
  renderSharedSummary();
  recalcAllPeople();
  scheduleSave();
  updateMobileToolbar();
});

mTransferredBtn?.addEventListener("click", () => {
  const idx = mobileSelectedIdx;
  if (idx < 0 || idx >= daysInMonth) return;

  const next = !sharedTransferredOff[idx];
  sharedHoliday[idx] = false;
  sharedTransferredOff[idx] = next;
  sharedShortDay[idx] = false;

  if (!next) sharedTransferredOff[idx] = false;

  updateDayMarkClasses(idx);
  renderSharedSummary();
  recalcAllPeople();
  scheduleSave();
  updateMobileToolbar();
});

mShortBtn?.addEventListener("click", () => {
  const idx = mobileSelectedIdx;
  if (idx < 0 || idx >= daysInMonth) return;

  const next = !sharedShortDay[idx];
  sharedHoliday[idx] = false;
  sharedTransferredOff[idx] = false;
  sharedShortDay[idx] = next;

  if (!next) sharedShortDay[idx] = false;

  updateDayMarkClasses(idx);
  renderSharedSummary();
  recalcAllPeople();
  scheduleSave();
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
  await doSaveAll();
});

exportExcelBtn?.addEventListener("click", async () => {
  await exportCurrentMonthToExcel();
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
      setMobileDay(mobileSelectedIdx);
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

