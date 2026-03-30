// =========================
// FILE: /profile.js
// =========================
// FILE: /profile.js
import { requireSession, signOut } from "./auth.js";
import {
  getMyProfile,
  updateMyProfile,
  listMyTimesheetsByYear,
  deleteMyTimesheet,
} from "./db.js";
import { parseNumber } from "./calc.js";
import { supabase } from "./supabaseClient.js";

document.body.classList.add("is-loaded");

const OVERTIME_LIMIT_YEAR = 120;
const SHORT_DAY_REDUCTION_HOURS = 1;

const DEFAULT_DAY_HOURS = 8;
const FEMALE_DAY_HOURS = 7.2;
let BASE_DAY_HOURS = DEFAULT_DAY_HOURS;

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
const overtimeAdjustmentEl = document.getElementById("overtimeAdjustment");
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

/* Avatar DOM */
const avatarFileInput = document.getElementById("avatarFileInput");
const avatarUploadBtn = document.getElementById("avatarUploadBtn");
const avatarRemoveBtn = document.getElementById("avatarRemoveBtn");
const avatarHint = document.getElementById("avatarHint");

/* ===== Avatar upload settings ===== */
const AVATAR_BUCKET = "avatars";
const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2MB
const AVATAR_ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const monthNamesShort = ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"];
const monthNamesFull = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const WEEK_LABELS = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];

let loadedYear = new Date().getFullYear();
let payloadByMonth = new Map();

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

function normalizeLeaveTypeLegacy(lt) {
  if (!lt) return null;
  if (lt === "vacation") return "vac_paid";
  if (lt === "sick") return "sick";
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
  return String(t);
}

function isCompensatoryLeaveForYear(lt) {
  const t = normalizeLeaveTypeLegacy(lt);
  // Эти отсутствия НЕ должны снижать годовую норму: их часы вычитаем из годовой переработки.
  return t === "sick" || t === "vac_unpaid" || t === "vac_unpaid_required" || t === "edu_paid" || t === "edu_unpaid";
}

function computeCompensatoryLeaveHours(payload) {
  if (!payload || typeof payload !== "object") return 0;

  const y = safeNum(payload.year);
  const m = safeNum(payload.month);
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  const isHoliday = Array.isArray(payload.isHoliday) ? payload.isHoliday : new Array(daysInMonth).fill(false);
  const leaveType = Array.isArray(payload.leaveType) ? payload.leaveType : new Array(daysInMonth).fill(null);

  let effectiveDays = 0;
  for (let i = 0; i < daysInMonth; i++) {
    if (isHoliday[i]) continue;
    if (!isCompensatoryLeaveForYear(leaveType[i])) continue;
    effectiveDays++;
  }

  return effectiveDays * BASE_DAY_HOURS;
}

/**
 * ✅ Align with table.js rules + BASE_DAY_HOURS:
 * - month norm: weekdays*BASE_DAY_HOURS - holidayWeekdays*BASE_DAY_HOURS - shortWeekdays*1
 * - personal norm: monthNorm - leaveEffective*BASE_DAY_HOURS
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

  const monthNorm =
    weekdays * BASE_DAY_HOURS -
    holidayWeekdays * BASE_DAY_HOURS -
    shortWeekdays * SHORT_DAY_REDUCTION_HOURS;

  let leaveEffective = 0;
  for (let i = 0; i < daysInMonth; i++) {
    const lt = normalizeLeaveTypeLegacy(leaveType[i]);
    if (!lt) continue;
    if (isHoliday[i]) continue;
    leaveEffective++;
  }

  const personalNorm = monthNorm - leaveEffective * BASE_DAY_HOURS;
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
    const marker = `/storage/v1/object/sign/${AVATAR_BUCKET}/`;
    const idx = url.pathname.indexOf(marker);
    if (idx === -1) return null;
    return decodeURIComponent(url.pathname.slice(idx + marker.length));
  } catch {
    return null;
  }
}

async function createFreshAvatarUrl(storedValue) {
  const path = extractAvatarPath(storedValue);
  if (!path) return null;

  const { data, error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .createSignedUrl(path, 60 * 60);

  if (error) throw error;
  return data?.signedUrl ?? null;
}

async function uploadAvatar(file) {
  if (!file) throw new Error("NO_FILE");
  if (!AVATAR_ALLOWED_TYPES.has(file.type)) throw new Error("Поддерживаются только JPG, PNG или WebP.");
  if (file.size > AVATAR_MAX_BYTES) throw new Error("Файл слишком большой. Максимум 2 MB.");

  const uid = await getUserIdOrThrow();
  const ext = guessExt(file);
  const path = `${uid}/avatar.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, file, {
      upsert: true,
      contentType: file.type,
      cacheControl: "3600"
    });

  if (upErr) throw upErr;

  // Сохраняем в профиле именно path, а не временную signed URL
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

  const name = profile?.display_name || "Пользователь";
  const oklad = profile?.oklad;

  if (!requireDom(displayNameEl, "displayName")) return;
  if (!requireDom(displayNameInput, "displayNameInput")) return;
  if (!requireDom(okladInput, "okladInput")) return;

  displayNameEl.textContent = name;
  displayNameInput.value = profile?.display_name ?? "";
  okladInput.value = oklad != null ? String(oklad) : "";
  if (genderSelect) genderSelect.value = profile?.gender ?? "";

  BASE_DAY_HOURS = profile?.gender === "female" ? FEMALE_DAY_HOURS : DEFAULT_DAY_HOURS;

  let avatarUrl = null;
  try {
    avatarUrl = await createFreshAvatarUrl(profile?.avatar_url || null);
  } catch (e) {
    console.warn("Не удалось получить свежую ссылку на аватар:", e);
  }

  setAvatarUI(avatarUrl, name);

  if (profile?.role === "admin") adminLink?.classList.remove("hidden");
  else adminLink?.classList.add("hidden");

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
    const markShort = Boolean(tsShort?.[idx]);

    if (markHoliday) btn.classList.add("cal-ts-holiday");
    else btn.classList.remove("cal-ts-holiday");

    if (markShort) btn.classList.add("cal-ts-short");
    else btn.classList.remove("cal-ts-short");

    const tags = document.createElement("div");
    tags.className = "cal-tags";

    const ltRaw = tsLeave?.[idx];
    const ltNorm = normalizeLeaveTypeLegacy(ltRaw);
    const ltCode = leaveTypeToCode(ltRaw);
    if (ltCode) {
      const t = document.createElement("span");
      t.className = ltNorm === "sick" ? "cal-tag sick" : "cal-tag leave";
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
  if (!requireDom(monthsCountEl, "monthsCount")) return;
  if (!requireDom(overtimeYearEl, "overtimeYear")) return;
  if (!requireDom(overtimeRemainingEl, "overtimeRemaining")) return;

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
  monthsCountEl.textContent = String(rows.length);

  let yearBalanceSigned = 0;
  let yearAdjustmentHours = 0;
  for (const r of rows) {
    if (!r?.payload) continue;
    yearBalanceSigned += computeMonthOvertimeSigned(r.payload);
    yearAdjustmentHours += computeCompensatoryLeaveHours(r.payload);
  }

  const adjustedYearBalance = yearBalanceSigned - yearAdjustmentHours;

  const usedForLimit = Math.max(0, adjustedYearBalance);
  const remaining = Math.max(0, OVERTIME_LIMIT_YEAR - usedForLimit);

  overtimeYearEl.textContent = formatHoursSigned(adjustedYearBalance);
  overtimeRemainingEl.textContent = formatHoursPlain(remaining);

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

    BASE_DAY_HOURS = gender === "female" ? FEMALE_DAY_HOURS : DEFAULT_DAY_HOURS;

    await refreshProfile();
    await refreshTimesheets();
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
    try { await refreshProfile(); } catch {}
  } finally {
    if (avatarFileInput) avatarFileInput.value = "";
  }
});

avatarRemoveBtn?.addEventListener("click", async () => {
  const ok = confirm("Удалить аватар?");
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
    try { await refreshProfile(); } catch {}
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

// ===== Кнопки обучения =====
const tourCalcBtn = document.getElementById('tourCalcBtn');
const tourTableBtn = document.getElementById('tourTableBtn');
const tourProfileBtn = document.getElementById('tourProfileBtn');

if (tourCalcBtn) {
  tourCalcBtn.addEventListener('click', () => {
    window.location.href = 'index.html?tour=calculator';
  });
}
if (tourTableBtn) {
  tourTableBtn.addEventListener('click', () => {
    window.location.href = 'table.html?tour=table';
  });
}
if (tourProfileBtn) {
  tourProfileBtn.addEventListener('click', () => {
    window.location.href = 'profile.html?tour=profile';
  });
}