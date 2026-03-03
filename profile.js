// /profile.js
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
const saveProfileBtn = document.getElementById("saveProfileBtn");
const refreshBtn = document.getElementById("refreshBtn");

const yearSelect = document.getElementById("yearSelect");
const overtimeYearEl = document.getElementById("overtimeYear");
const overtimeRemainingEl = document.getElementById("overtimeRemaining");
const monthsCountEl = document.getElementById("monthsCount");
const timesheetsList = document.getElementById("timesheetsList");

// ✅ progress bar
const overtimeBarFill = document.getElementById("overtimeBarFill");
const overtimeBarText = document.getElementById("overtimeBarText");

const monthNames = ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"];

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
 * ✅ Переработка за месяц:
 * - Норма месяца уменьшается только за праздники (будни, отмеченные holiday)
 * - Личная норма = норма месяца - (ОТ+Б)*8
 * - Переработка = max(0, отработано - личная норма)
 */
function computeMonthOvertime(payload) {
  if (!payload || typeof payload !== "object") return 0;

  const y = safeNum(payload.year);
  const m = safeNum(payload.month);
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  const isHoliday = Array.isArray(payload.isHoliday) ? payload.isHoliday : new Array(daysInMonth).fill(false);
  const dayHours = Array.isArray(payload.dayHours) ? payload.dayHours : new Array(daysInMonth).fill(0);
  const nightHours = Array.isArray(payload.nightHours) ? payload.nightHours : new Array(daysInMonth).fill(0);
  const leaveType = Array.isArray(payload.leaveType) ? payload.leaveType : new Array(daysInMonth).fill(null);

  let weekdays = 0;
  let holidayWeekdays = 0;
  for (let i = 0; i < daysInMonth; i++) {
    if (isWeekendByIndex(y, m, i)) continue;
    weekdays++;
    if (isHoliday[i]) holidayWeekdays++;
  }

  const normMonth = (weekdays - holidayWeekdays) * 8;

  const vacDays = leaveType.filter((t) => t === "vacation").length;
  const sickDays = leaveType.filter((t) => t === "sick").length;
  const personalNorm = normMonth - (vacDays + sickDays) * LEAVE_HOURS_PER_DAY;

  const workedTotal = sum(dayHours) + sum(nightHours);
  const overtime = workedTotal - personalNorm;

  return overtime > 0 ? overtime : 0;
}

function formatHours(h) {
  const n = Number(h);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(1)} ч`;
}

function fillYearOptions(currentYear) {
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

function applyOvertimeProgress(usedHours) {
  if (!overtimeBarFill || !overtimeBarText) return;

  const used = Math.max(0, Number(usedHours) || 0);
  const pct = Math.min(100, (used / OVERTIME_LIMIT_YEAR) * 100);

  overtimeBarText.textContent = `${used.toFixed(1)} / ${OVERTIME_LIMIT_YEAR} ч`;

  overtimeBarFill.style.width = `${pct}%`;

  overtimeBarFill.classList.remove(
    "bg-emerald-400/80",
    "bg-sky-400/80",
    "bg-amber-400/85",
    "bg-rose-400/85"
  );

  // <= 60% — ок, 60-85% — внимание, 85-100% — почти лимит, >100 (внутри 100%) — красный
  if (pct < 60) overtimeBarFill.classList.add("bg-emerald-400/80");
  else if (pct < 85) overtimeBarFill.classList.add("bg-sky-400/80");
  else if (pct < 100) overtimeBarFill.classList.add("bg-amber-400/85");
  else overtimeBarFill.classList.add("bg-rose-400/85");
}

function createTimesheetCard(row) {
  const y = row.year;
  const m = row.month;
  const updatedAt = row.updated_at ? new Date(row.updated_at) : null;

  const overtime = row.payload ? computeMonthOvertime(row.payload) : 0;

  const card = document.createElement("div");
  card.className = "glass-card hover-lift rounded-3xl bg-slate-950/25 p-4 ring-1 ring-white/10";

  const top = document.createElement("div");
  top.className = "flex items-start justify-between gap-3";

  const left = document.createElement("div");
  left.className = "min-w-0";

  const title = document.createElement("div");
  title.className = "text-base font-semibold text-slate-100 truncate";
  title.textContent = `${monthNames[m]} ${y}`;

  const meta = document.createElement("div");
  meta.className = "mt-1 text-xs text-slate-400/90";
  meta.textContent = updatedAt
    ? `Обновлён: ${updatedAt.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}`
    : "Обновлён: —";

  const ov = document.createElement("div");
  ov.className = "mt-2 inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs ring-1 ring-white/10";
  ov.innerHTML = `<span class="h-1.5 w-1.5 rounded-full ${overtime > 0 ? "bg-amber-400/80" : "bg-emerald-400/80"}"></span>
                  <span class="text-slate-200">Переработка:</span>
                  <span class="font-semibold text-slate-100">${formatHours(overtime)}</span>`;

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
    const ok = confirm(`Удалить табель за ${monthNames[m]} ${y}? Это действие нельзя отменить.`);
    if (!ok) return;

    setStatus("Удаляю…", "busy");
    setError(null);

    try {
      await deleteMyTimesheet(y, m);
      setStatus("Удалено", "ok");
      await refreshTimesheets();
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

  displayNameEl.textContent = name;
  displayNameInput.value = profile?.display_name ?? "";
  okladInput.value = oklad != null ? String(oklad) : "";

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

async function refreshTimesheets() {
  const y = Number(yearSelect.value);
  setStatus("Загружаю табели…", "busy");
  setError(null);

  const rows = await listMyTimesheetsByYear(y, { withPayload: true });

  timesheetsList.innerHTML = "";
  monthsCountEl.textContent = String(rows.length);

  let overtimeYear = 0;
  for (const r of rows) {
    overtimeYear += r?.payload ? computeMonthOvertime(r.payload) : 0;
  }

  const remaining = Math.max(0, OVERTIME_LIMIT_YEAR - overtimeYear);

  overtimeYearEl.textContent = formatHours(overtimeYear);
  overtimeRemainingEl.textContent = formatHours(remaining);

  applyOvertimeProgress(overtimeYear);

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "rounded-3xl bg-slate-950/25 p-4 ring-1 ring-white/10 text-sm text-slate-300/90";
    empty.textContent = "Пока нет сохранённых табелей за этот год.";
    timesheetsList.appendChild(empty);
    setStatus("Нечего показывать", "neutral");
    return;
  }

  rows.sort((a, b) => (a.month ?? 0) - (b.month ?? 0));
  for (const row of rows) {
    timesheetsList.appendChild(createTimesheetCard(row));
  }

  setStatus("Готово", "ok");
}

async function saveProfile() {
  const displayName = displayNameInput.value.trim();
  const oklad = parseNumber(okladInput.value);

  if (displayName && displayName.length < 2) {
    setError("Имя слишком короткое (минимум 2 символа).");
    return;
  }
  if (okladInput.value.trim() && (!Number.isFinite(oklad) || oklad < 0)) {
    setError("Оклад должен быть числом ≥ 0.");
    return;
  }

  setStatus("Сохраняю…", "busy");
  setError(null);

  try {
    await updateMyProfile({
      displayName: displayName || null,
      oklad: okladInput.value.trim() ? oklad : null,
    });
    await refreshProfile();
    setStatus("Сохранено", "ok");
  } catch (e) {
    setStatus("Ошибка сохранения", "err");
    setError(e?.message || "Не удалось сохранить профиль.");
  }
}

// events
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

yearSelect?.addEventListener("change", () => void refreshTimesheets());

// boot
(async () => {
  try {
    await requireSession();
  } catch {
    location.href = "login.html?next=profile.html";
    return;
  }

  const currentYear = new Date().getFullYear();
  fillYearOptions(currentYear);

  try {
    await refreshProfile();
    await refreshTimesheets();
  } catch (e) {
    setStatus("Ошибка загрузки", "err");
    setError(e?.message || "Не удалось загрузить данные кабинета.");
  }
})();