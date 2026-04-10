// =========================
// FILE: /admin.js
// =========================
import { requireSession, signOut } from "./auth.js";
import {
  getMyProfile,
  adminGetProfilesByIds,
  adminLoadTimesheet,
  adminSaveManyTimesheets,
} from "./db.js";

document.body.classList.add("is-loaded");

const TEAM = [
  {
    userId: "4cadc9e5-8b98-4ef1-b7b0-bb39e5f034c4",
    name: "Мирзоев Ханахмед",
    isOwner: true,
  },
  {
    userId: "34c68288-ba6e-49a0-aaed-075ddfa5059f",
    name: "Гасанов Камиль",
  },
  {
    userId: "97da2f37-61d9-40e1-9521-4cac3def2671",
    name: "Герейханов Пирбала",
  },
  {
    userId: "5adab14c-3262-43a4-9ef5-6294f5d29e6e",
    name: "Гусейнов Вели",
  },
];

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

let year = new Date().getFullYear();
let month = new Date().getMonth();
let daysInMonth = 31;

let teamStates = [];
let sharedHoliday = [];
let sharedShortDay = [];
let headerCells = [];
let columnCells = [];

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

function setSaveStatus(text, tone = "neutral") {
  saveStatus.textContent = text;
  saveStatus.className =
    "inline-flex items-center rounded-full px-4 py-1.5 text-xs ring-1 backdrop-blur-sm";

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
  const s = String(raw ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(",", ".");
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
  let s = String(raw ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^0-9.,]/g, "");

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

function attachPrevValueTracking(inputEl) {
  inputEl.addEventListener("focus", () => {
    inputEl.dataset.prev = inputEl.value ?? "";
  });
}

function createState(member, profile) {
  return {
    userId: member.userId,
    name: member.name,
    gender: profile?.gender ?? null,
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

function getStateByUserId(userId) {
  return teamStates.find((x) => x.userId === userId) ?? null;
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

function resetMonthArrays(profileMap) {
  daysInMonth = new Date(year, month + 1, 0).getDate();
  sharedHoliday = new Array(daysInMonth).fill(false);
  sharedShortDay = new Array(daysInMonth).fill(false);
  headerCells = [];
  columnCells = Array.from({ length: daysInMonth }, () => []);
  teamStates = TEAM.map((member) => createState(member, profileMap.get(member.userId)));
}

function getOwnerUserId() {
  return TEAM.find((x) => x.isOwner)?.userId ?? TEAM[0].userId;
}

function chooseSharedMarkSource(payloadsByUserId) {
  const ownerPayload = payloadsByUserId.get(getOwnerUserId());
  if (
    ownerPayload &&
    Array.isArray(ownerPayload.isHoliday) &&
    ownerPayload.isHoliday.length === daysInMonth
  ) {
    return ownerPayload;
  }

  for (const payload of payloadsByUserId.values()) {
    if (
      payload &&
      Array.isArray(payload.isHoliday) &&
      payload.isHoliday.length === daysInMonth
    ) {
      return payload;
    }
  }

  return null;
}

function applyLoadedPayloads(payloadsByUserId) {
  const sharedSource = chooseSharedMarkSource(payloadsByUserId);

  if (sharedSource?.isHoliday?.length === daysInMonth) {
    sharedHoliday = sharedSource.isHoliday.map(Boolean);
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

  const meta = document.createElement("span");
  meta.className = "label-meta";
  

  td.append(main, sub, meta);
  return td;
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
  th.title = "Клик — праздник. Двойной клик — сокращённый день.";

  let clickTimer = null;

  th.addEventListener("click", () => {
    if (clickTimer) return;
    clickTimer = setTimeout(() => {
      clickTimer = null;
      sharedShortDay[dayIndex] = false;
      sharedHoliday[dayIndex] = !sharedHoliday[dayIndex];
      updateDayMarkClasses(dayIndex);
      recalcAll();
      scheduleSave();
    }, 240);
  });

  th.addEventListener("dblclick", () => {
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    if (sharedHoliday[dayIndex]) sharedHoliday[dayIndex] = false;
    sharedShortDay[dayIndex] = !sharedShortDay[dayIndex];
    updateDayMarkClasses(dayIndex);
    recalcAll();
    scheduleSave();
  });

  return th;
}

function currentPayloadForState(state) {
  return {
    v: 4,
    year,
    month,
    isHoliday: [...sharedHoliday],
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

function attachArrowNavigation(inputEl, state, rowType, index) {
  inputEl.dataset.row = rowType;
  inputEl.dataset.idx = String(index);
  inputEl.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const key = e.key;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) return;

    if ((key === "ArrowLeft" || key === "ArrowRight") && typeof inputEl.selectionStart === "number") {
      const start = inputEl.selectionStart ?? 0;
      const end = inputEl.selectionEnd ?? 0;
      const len = String(inputEl.value ?? "").length;

      if (key === "ArrowLeft" && !(start === 0 && end === 0)) return;
      if (key === "ArrowRight" && !(start === len && end === len)) return;
    }

    e.preventDefault();

    if (key === "ArrowLeft") focusHorizontal(state, rowType, index - 1, -1);
    else if (key === "ArrowRight") focusHorizontal(state, rowType, index + 1, 1);
    else if (key === "ArrowUp") focusCell(state, rowType === "day" ? "night" : "day", index);
    else if (key === "ArrowDown") focusCell(state, rowType === "day" ? "night" : "day", index);
  });
}

function createDayInput(state, i) {
  const weekend = isWeekendByIndex(year, month, i);
  const td = document.createElement("td");
  td.dataset.dayIndex = String(i);

  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "text";
  input.className = "input-hour";
  input.autocapitalize = "characters";
  input.spellcheck = false;

  attachPrevValueTracking(input);
  attachArrowNavigation(input, state, "day", i);

  input.addEventListener("blur", () => {
    const s = String(input.value ?? "").trim();
    if (s === "0" || s === "0.0" || s === "0,0") {
      input.value = "";
      state.dayHours[i] = 0;
      recalcAll();
      scheduleSave();
      return;
    }
    if (String(input.value ?? "").trim().toUpperCase() === "О") {
      input.value = "ОТ";
      input.dataset.prev = "ОТ";
    }
  });

  input.addEventListener("input", () => {
    const sanitized = sanitizeDayCellValue(input.value);
    if (sanitized !== input.value) input.value = sanitized;

    const raw = input.value;

    if (!raw.trim()) {
      setError(null);
      if (state.leaveType[i]) {
        state.leaveType[i] = null;
        unlockNightCell(state, i);
      }
      state.dayHours[i] = 0;
      input.dataset.prev = "";
      recalcAll();
      scheduleSave();
      return;
    }

    const parsed = parseHoursOrLeave(raw);

    if (parsed.kind === "leave") {
      if (weekend) {
        setError("Коды отсутствия нельзя ставить на выходные (сб/вс).");
        revertToPrev(input);
        return;
      }

      setError(null);
      state.leaveType[i] = parsed.leave;
      input.value = sanitizeLeaveDisplayValue(raw, parsed.leave);
      state.dayHours[i] = 0;
      state.nightHours[i] = 0;
      lockNightCell(state, i);
      input.dataset.prev = input.value;
      recalcAll();
      scheduleSave();
      return;
    }

    if (parsed.kind === "hours") {
      setError(null);
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
      recalcAll();
      scheduleSave();
      return;
    }

    setError(`Некорректное значение у ${state.name}, день ${i + 1}. Допустимы числа или коды: ОТ, ОД, ОЗ, У, УД, Б.`);
  });

  td.appendChild(input);
  state.dayInputs.push(input);
  columnCells[i].push(td);

  return td;
}

function createNightInput(state, i) {
  const td = document.createElement("td");
  td.className = "night-cell";
  td.dataset.dayIndex = String(i);

  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "decimal";
  input.className = "input-hour";
  input.spellcheck = false;

  attachPrevValueTracking(input);
  attachArrowNavigation(input, state, "night", i);

  input.addEventListener("blur", () => {
    const s = String(input.value ?? "").trim();
    if (s === "0" || s === "0.0" || s === "0,0") {
      input.value = "";
      state.nightHours[i] = 0;
      recalcAll();
      scheduleSave();
    }
  });

  input.addEventListener("input", () => {
    if (state.leaveType[i]) return;

    const sanitized = sanitizeNumericValue(input.value);
    if (sanitized !== input.value) input.value = sanitized;

    const raw = input.value;
    if (!raw.trim()) {
      setError(null);
      state.nightHours[i] = 0;
      input.dataset.prev = "";
      recalcAll();
      scheduleSave();
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

    setError(null);
    state.nightHours[i] = nextNight;
    input.dataset.prev = input.value;
    recalcAll();
    scheduleSave();
  });

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

  const labelTh = document.createElement("th");
  labelTh.className = "label-cell";
  labelTh.textContent = "Оператор";
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
      dayTr.appendChild(createDayInput(state, i));
    }

    const summaryTd = document.createElement("td");
    summaryTd.className = "summary-cell";
    summaryTd.rowSpan = 2;
    state.summaryEl = summaryTd;
    dayTr.appendChild(summaryTd);

    for (let i = 0; i < daysInMonth; i++) {
      nightTr.appendChild(createNightInput(state, i));
    }

    matrixBody.append(dayTr, nightTr);
  }

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

  recalcAll();
}

function updateDayMarkClasses(index) {
  const cells = columnCells[index] ?? [];
  for (const el of cells) {
    el.classList.remove("holiday-col", "short-col", "weekend-col");
    if (isWeekendByIndex(year, month, index)) el.classList.add("weekend-col");
    if (sharedHoliday[index]) el.classList.add("holiday-col");
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
  let shortWeekdays = 0;

  for (let i = 0; i < daysInMonth; i++) {
    if (isWeekendByIndex(year, month, i)) continue;
    weekdays++;
    if (sharedHoliday[i]) holidayWeekdays++;
    else if (sharedShortDay[i]) shortWeekdays++;
  }

  return weekdays * baseDayHours
    - holidayWeekdays * baseDayHours
    - shortWeekdays * SHORT_DAY_REDUCTION_HOURS;
}

function calendarFirstHalfNormForBase(baseDayHours) {
  const endIdx = Math.min(14, daysInMonth - 1);
  let weekdays = 0;
  let holidayWeekdays = 0;
  let shortWeekdays = 0;

  for (let i = 0; i <= endIdx; i++) {
    if (isWeekendByIndex(year, month, i)) continue;
    weekdays++;
    if (sharedHoliday[i]) holidayWeekdays++;
    else if (sharedShortDay[i]) shortWeekdays++;
  }

  return weekdays * baseDayHours
    - holidayWeekdays * baseDayHours
    - shortWeekdays * SHORT_DAY_REDUCTION_HOURS;
}

function personalNormHours(state) {
  const baseDayHours = getBaseDayHours(state.gender);
  const monthNorm = calendarNormHoursForBase(baseDayHours);

  let effectiveLeaveDays = 0;
  for (let i = 0; i < daysInMonth; i++) {
    const lt = normalizeLeaveTypeLegacy(state.leaveType[i]);
    if (!lt) continue;
    if (!sharedHoliday[i]) effectiveLeaveDays++;
  }

  const personalNorm = monthNorm - effectiveLeaveDays * baseDayHours;
  return { monthNorm, personalNorm };
}

function firstHalfStats(state) {
  const baseDayHours = getBaseDayHours(state.gender);
  const endIdx = Math.min(14, daysInMonth - 1);

  let weekdays = 0;
  let holidayWeekdays = 0;
  let shortWeekdays = 0;
  let leaveEffectiveDays = 0;

  for (let i = 0; i <= endIdx; i++) {
    if (isWeekendByIndex(year, month, i)) continue;
    weekdays++;
    if (sharedHoliday[i]) holidayWeekdays++;
    else if (sharedShortDay[i]) shortWeekdays++;

    const lt = normalizeLeaveTypeLegacy(state.leaveType[i]);
    if (lt && !sharedHoliday[i]) leaveEffectiveDays++;
  }

  const monthHalfNorm =
    weekdays * baseDayHours
    - holidayWeekdays * baseDayHours
    - shortWeekdays * SHORT_DAY_REDUCTION_HOURS;

  const personalHalfNorm = monthHalfNorm - leaveEffectiveDays * baseDayHours;
  const workedFH =
    sumRange(state.dayHours, 0, endIdx) +
    sumRange(state.nightHours, 0, endIdx);

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
  const ownerState = getStateByUserId(getOwnerUserId());
  return getBaseDayHours(ownerState?.gender ?? null);
}

function recalcAll() {
  setError(null);

  monthYearDisplay.textContent = `${monthNames[month]} ${year}`;
  teamCountEl.textContent = String(TEAM.length);

  const baseHours = getReferenceBaseHours();
  normMonthEl.textContent = fmtHours(calendarNormHoursForBase(baseHours));
  normFirstHalfEl.textContent = fmtHours(calendarFirstHalfNormForBase(baseHours));

  for (const state of teamStates) {
    updatePersonSummary(state);
  }
}

async function doSaveAll() {
  setSaveStatus("Сохраняю…", "busy");

  try {
    const items = currentSaveItems();
    await adminSaveManyTimesheets(items);
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

async function guardAdmin() {
  try {
    await requireSession();
  } catch {
    location.href = "login.html?next=admin.html";
    return false;
  }

  const profile = await getMyProfile();
  if (!profile || profile.role !== "admin") {
    setError("Доступ запрещён. Запросите разрешение у администратора");
    return false;
  }

  return true;
}

async function loadCurrentMonth() {
  setSaveStatus("Загружаю…", "busy");

  try {
    const ids = TEAM.map((x) => x.userId);
    const [profileRows, payloads] = await Promise.all([
      adminGetProfilesByIds(ids),
      Promise.all(ids.map((id) => adminLoadTimesheet(id, year, month))),
    ]);

    const profileMap = new Map(profileRows.map((x) => [x.user_id, x]));
    resetMonthArrays(profileMap);

    const payloadsByUserId = new Map();
    for (let i = 0; i < ids.length; i++) {
      payloadsByUserId.set(ids[i], payloads[i]);
    }

    applyLoadedPayloads(payloadsByUserId);
    buildTable();

    lastSavedSignature = currentSignature();
    dirty = false;
    setSaveStatus("Сохранено", "ok");
  } catch (e) {
    setSaveStatus("Ошибка загрузки", "err");
    setError(e?.message || "Не удалось загрузить общий табель.");
  }
}

logoutBtn.addEventListener("click", async () => {
  try {
    await signOut();
  } finally {
    location.href = "login.html";
  }
});

saveBtn.addEventListener("click", async () => {
  await doSaveAll();
});

reloadBtn.addEventListener("click", async () => {
  await loadCurrentMonth();
});

monthSelect.addEventListener("change", async () => {
  month = Number(monthSelect.value);
  updateUrlForMonth();
  await loadCurrentMonth();
});

yearSelect.addEventListener("change", async () => {
  year = Number(yearSelect.value);
  updateUrlForMonth();
  await loadCurrentMonth();
});

window.addEventListener("beforeunload", (e) => {
  if (!dirty) return;
  e.preventDefault();
  e.returnValue = "";
});

(async () => {
  try {
    setError(null);

    const ok = await guardAdmin();
    if (!ok) return;

    setFromQueryOrNow();
    fillYearOptions();
    updateUrlForMonth();
    await loadCurrentMonth();
  } catch (e) {
    setError(e?.message || "Ошибка админки.");
    setSaveStatus("Ошибка", "err");
  }
})();


