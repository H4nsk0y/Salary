// FILE: /profile.js
import { requireSession, signOut } from "./auth.js";
import {
  getMyProfile,
  updateMyProfile,
  listMyTimesheetsByYear,
  deleteMyTimesheet,
} from "./db.js";
import { parseNumber } from "./calc.js";

document.body.classList.add("is-loaded");

const OVERTIME_LIMIT_YEAR = 120;
const LEAVE_HOURS_PER_DAY = 8;
const SHORT_DAY_REDUCTION_HOURS = 1;

const logoutBtn = document.getElementById("logoutBtn");
const adminLink = document.getElementById("adminLink");

const statusPill = document.getElementById("statusPill");
const errorBox = document.getElementById("errorBox");

const avatarImg = document.getElementById("avatarImg");
const avatarFallback = document.getElementById("avatarFallback");
const displayNameEl = document.getElementById("displayName");
const emailHint = document.getElementById("emailHint");

const displayNameInput = document.getElementById("displayNameInput");
const okladInput = document.getElementById("okladInput");
const genderSelect = document.getElementById("genderSelect");
const saveProfileBtn = document.getElementById("saveProfileBtn");
const refreshBtn = document.getElementById("refreshBtn");

const yearSelect = document.getElementById("yearSelect");
const overtimeYearEl = document.getElementById("overtimeYear");
const overtimeRemainingEl = document.getElementById("overtimeRemaining");
const monthsCountEl = document.getElementById("monthsCount");
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

const monthNamesShort = ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"];
const monthNamesFull = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const WEEK_LABELS = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];

let loadedYear = new Date().getFullYear();
let payloadByMonth = new Map(); // month -> payload (current loaded year)

let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();

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

/**
 * ✅ Align with table.js rules:
 * - month norm: weekdays*8 - holidayWeekdays*8 - shortWeekdays*1
 * - personal norm: monthNorm - leaveEffective*8
 *   (leaveEffective excludes holiday days to avoid double subtraction)
 */
function computeMonthOvertimeSigned(payload) {
  if (!payload || typeof payload !== "object") return 0;

  const y = safeNum(payload.year);
  const m = safeNum(payload.month);
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  const isHoliday = Array.isArray(payload.isHoliday) ? payload.isHoliday : new Array(daysInMonth).fill(false);
  const isShortDay = Array.isArray(payload.isShortDay) ? payload.isShortDay : new Array(daysInMonth).fill(false);
  const dayHours = Array.isArray(payload.dayHours) ? payload.dayHours : new Array(daysInMonth).fill(0);
  const nightHours = Array.isArray(payload.nightHours) ? payload.nightHours : new Array(daysInMonth).fill(0);
  const leaveType = Array.isArray(payload.leaveType) ? payload.leaveType : new Array(daysInMonth).fill(null);

  let weekdays = 0;
  let holidayWeekdays = 0;
  let shortWeekdays = 0;

  for (let i = 0; i < daysInMonth; i++) {
    if (isWeekendByIndex(y, m, i)) continue;
    weekdays++;
    if (isHoliday[i]) holidayWeekdays++;
    else if (isShortDay[i]) shortWeekdays++;
  }

  const monthNorm = weekdays * 8 - holidayWeekdays * 8 - shortWeekdays * SHORT_DAY_REDUCTION_HOURS;

  let leaveEffective = 0;
  for (let i = 0; i < daysInMonth; i++) {
    const lt = leaveType[i];
    if (lt !== "vacation" && lt !== "sick") continue;
    if (isHoliday[i]) continue; // ✅ avoid double subtraction on holiday+leave
    leaveEffective++;
  }

  const personalNorm = monthNorm - leaveEffective * LEAVE_HOURS_PER_DAY;
  const workedTotal = sum(dayHours) + sum(nightHours);

  return workedTotal - personalNorm;
}

function formatHoursSigned(h) {
  const n = Number(h);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n).toFixed(1);
  if (n > 0.0001) return `+${abs} ч`;
  if (n < -0.0001) return `−${abs} ч`;
  return `0.0 ч`;
}

function formatHoursPlain(h) {
  const n = Number(h);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(1)} ч`;
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

  const ov = document.createElement("div");
  ov.className = "mt-2 inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs ring-1 ring-white/10";
  ov.innerHTML = `<span class="h-1.5 w-1.5 rounded-full ${dotClass}"></span>
                  <span class="text-slate-200">${labelText}</span>
                  <span class="font-semibold ${valueClass}">${valueText}</span>`;

  left.appendChild(title);
  left.appendChild(meta);
  left.appendChild(ov);

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
    const ok = confirm(`Удалить табель за ${monthNamesShort[m]} ${y}? Это действие нельзя отменить.`);
    if (!ok) return;

    setStatus("Удаляю…", "busy");
    setError(null);

    try {
      await deleteMyTimesheet(y, m);
      setStatus("Удалено", "ok");
      await refreshTimesheets();
      await renderCalendar(); // sync
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

async function refreshProfile() {
  setStatus("Загружаю профиль…", "busy");
  setError(null);

  const profile = await getMyProfile();

  const name = profile?.display_name || "Пользователь";
  const oklad = profile?.oklad;

  if (!requireDom(displayNameEl, "displayName")) return;
  if (!requireDom(displayNameInput, "displayNameInput")) return;
  if (!requireDom(okladInput, "okladInput")) return;

  displayNameEl.textContent = name;
  displayNameInput.value = profile?.display_name ?? "";
  okladInput.value = oklad != null ? String(oklad) : "";
  if (genderSelect) genderSelect.value = profile?.gender ?? "";

  if (profile?.avatar_url) {
    avatarImg.src = profile.avatar_url;
    avatarImg.classList.remove("hidden");
    avatarFallback.classList.add("hidden");
  } else {
    avatarImg.removeAttribute("src");
    avatarFallback.classList.remove("hidden");
    avatarImg.classList.add("hidden");
    avatarFallback.textContent = (name?.trim?.()[0] || "A").toUpperCase();
  }

  if (profile?.role === "admin") adminLink?.classList.remove("hidden");
  else adminLink?.classList.add("hidden");

  setStatus("Профиль загружен", "ok");
}

/* ========= Production calendar (isdayoff) + cache ========= */

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
  } catch {
    // ignore
  }

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
    } catch {
      // ignore
    }

    return parsed;
  } catch {
    // fallback: weekends only (0=work,1=weekend)
    const out = [];
    for (let i = 0; i < days; i++) {
      out.push(isWeekendByIndex(y, m, i) ? 1 : 0);
    }
    return out;
  }
}

/* ========= Calendar rendering ========= */

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
  // JS: 0=Sun..6=Sat -> Mon=0..Sun=6
  return (jsDay + 6) % 7;
}

function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function computeHeat(totalHours) {
  const HEAT_MAX = 12; // 11ч смена близко к 1.0
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

    // official layer
    const code = Number(prod?.[idx] ?? 0);
    const offHoliday = code === 8;
    const offShort = code === 2;
    const offWeekend = code === 1;

    if (offHoliday) btn.classList.add("cal-off-holiday");
    else if (offShort) btn.classList.add("cal-off-short");
    else if (offWeekend) btn.classList.add("cal-off-weekend");

    // today ring
    if (dayNum === todayDay) btn.classList.add("cal-today");

    // heat layer from timesheet
    const dh = Number(tsDay?.[idx] ?? 0);
    const nh = Number(tsNight?.[idx] ?? 0);
    const total = dh + nh;
    btn.style.setProperty("--heat", String(computeHeat(total)));

    // numbers (small)
    const num = document.createElement("div");
    num.className = "cal-daynum";
    num.textContent = String(dayNum);
    btn.appendChild(num);

    // markers for timesheet flags
    const markHoliday = Boolean(tsHoliday?.[idx]);
    const markShort = Boolean(tsShort?.[idx]);

    if (markHoliday || markShort) {
      const dot = document.createElement("span");
      dot.className = "cal-mark " + (markHoliday ? "holiday" : "short");
      btn.appendChild(dot);
    }

    // tags: leave / night
    const tags = document.createElement("div");
    tags.className = "cal-tags";

    const lt = tsLeave?.[idx];
    if (lt === "vacation") {
      const t = document.createElement("span");
      t.className = "cal-tag leave";
      t.textContent = "ОТ";
      tags.appendChild(t);
    } else if (lt === "sick") {
      const t = document.createElement("span");
      t.className = "cal-tag sick";
      t.textContent = "Б";
      tags.appendChild(t);
    }

    if ((Number(nh) || 0) > 0.0001) {
      const t = document.createElement("span");
      t.className = "cal-tag night";
      t.textContent = "Н";
      tags.appendChild(t);
    }

    if (tags.childElementCount) btn.appendChild(tags);

    // tooltip (no clutter in UI)
    const parts = [];
    if (total > 0) parts.push(`Часы: ${total.toFixed(1)} (день ${dh.toFixed(1)}, ночь ${nh.toFixed(1)})`);
    if (lt === "vacation") parts.push("Отпуск");
    if (lt === "sick") parts.push("Больничный");
    if (offHoliday) parts.push("Официальный праздник");
    if (offShort) parts.push("Официальный сокращённый");
    if (offWeekend) parts.push("Официальный выходной");
    if (markHoliday) parts.push("Отметка табеля: праздник");
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

  // keep yearSelect in sync when year changes
  ensureYearOption(calYear);
  if (yearSelect && Number(yearSelect.value) !== calYear) {
    yearSelect.value = String(calYear);
    await refreshTimesheets(); // loads payloadByMonth for new year
  } else {
    await renderCalendar();
  }
}

/* ========= Timesheets ========= */

async function refreshTimesheets() {
  if (!requireDom(yearSelect, "yearSelect")) return;
  if (!requireDom(timesheetsList, "timesheetsList")) return;
  if (!requireDom(monthsCountEl, "monthsCount")) return;
  if (!requireDom(overtimeYearEl, "overtimeYear")) return;
  if (!requireDom(overtimeRemainingEl, "overtimeRemaining")) return;

  const y = Number(yearSelect.value);
  loadedYear = y;

  setStatus("Загружаю табели…", "busy");
  setError(null);

  const rows = await listMyTimesheetsByYear(y, { withPayload: true });

  // map month->payload for calendar
  payloadByMonth = new Map();
  for (const r of rows) {
    if (r && typeof r.month === "number" && r.payload) payloadByMonth.set(r.month, r.payload);
  }

  timesheetsList.innerHTML = "";
  monthsCountEl.textContent = String(rows.length);

  let yearBalanceSigned = 0;
  for (const r of rows) yearBalanceSigned += r?.payload ? computeMonthOvertimeSigned(r.payload) : 0;

  const usedForLimit = Math.max(0, yearBalanceSigned);
  const remaining = Math.max(0, OVERTIME_LIMIT_YEAR - usedForLimit);

  overtimeYearEl.textContent = formatHoursSigned(yearBalanceSigned);
  overtimeRemainingEl.textContent = formatHoursPlain(remaining);

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

  // calendar should reflect newly loaded year payloads
  if (calYear !== loadedYear) {
    calYear = loadedYear;
    calMonth = new Date().getMonth();
  }
  await renderCalendar();
}

async function saveProfile() {
  if (!requireDom(displayNameInput, "displayNameInput")) return;
  if (!requireDom(okladInput, "okladInput")) return;

  const displayName = displayNameInput.value.trim();
  const oklad = parseNumber(okladInput.value);
  const gender = genderSelect ? String(genderSelect.value || "") : "";

  if (displayName && displayName.length < 2) {
    setError("Имя слишком короткое (минимум 2 символа).");
    return;
  }
  if (okladInput.value.trim() && (!Number.isFinite(oklad) || oklad < 0)) {
    setError("Оклад должен быть числом ≥ 0.");
    return;
  }
  if (gender && gender !== "male" && gender !== "female") {
    setError("Пол должен быть: мужской или женский.");
    return;
  }

  setStatus("Сохраняю…", "busy");
  setError(null);

  try {
    await updateMyProfile({
      displayName: displayName || null,
      oklad: okladInput.value.trim() ? oklad : null,
      gender: gender ? gender : null,
    });
    await refreshProfile();
    setStatus("Сохранено", "ok");
  } catch (e) {
    setStatus("Ошибка сохранения", "err");
    setError(e?.message || "Не удалось сохранить профиль.");
  }
}

/* ========= events ========= */

logoutBtn?.addEventListener("click", async () => {
  try { await signOut(); }
  finally { location.href = "login.html?next=profile.html"; }
});

saveProfileBtn?.addEventListener("click", () => void saveProfile());

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
  // sync calendar year with selected year, keep month the same
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

/* ========= boot ========= */

(async () => {
  try {
    await requireSession();
  } catch {
    location.href = "login.html?next=profile.html";
    return;
  }

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