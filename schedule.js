import { requireSession } from "./auth.js";
import { listDepartmentShiftOverview } from "./db.js";
import { startPresenceHeartbeat } from "./presence.js";

document.body.classList.add("is-loaded");

const refreshBtn = document.getElementById("refreshBtn");
const statusPill = document.getElementById("statusPill");
const updatedAtPill = document.getElementById("updatedAtPill");
const errorBox = document.getElementById("errorBox");
const departmentLabel = document.getElementById("departmentLabel");
const daysGrid = document.getElementById("daysGrid");
const emptyState = document.getElementById("emptyState");
const todayWorkCount = document.getElementById("todayWorkCount");
const tomorrowWorkCount = document.getElementById("tomorrowWorkCount");
const departmentCount = document.getElementById("departmentCount");
const hideRestCheckbox = document.getElementById("hideRestCheckbox");

let rows = [];
let isLoading = false;
const HIDE_REST_KEY = "alvisa_schedule_hide_rest_after_night";

const LEAVE_LABELS = {
  vac_paid: "Отпуск",
  vac_unpaid: "Отпуск без оплаты",
  vac_unpaid_required: "Обязательный отпуск",
  sick: "Больничный",
  edu_paid: "Учебный отпуск",
  edu_unpaid: "Учебный без оплаты",
};

function setStatus(text, tone = "neutral") {
  if (!statusPill) return;

  statusPill.textContent = text;
  statusPill.classList.remove(
    "bg-white/5", "text-slate-300",
    "bg-emerald-500/10", "text-emerald-200",
    "bg-rose-500/10", "text-rose-200",
    "bg-sky-500/10", "text-sky-200"
  );

  if (tone === "ok") statusPill.classList.add("bg-emerald-500/10", "text-emerald-200");
  else if (tone === "err") statusPill.classList.add("bg-rose-500/10", "text-rose-200");
  else if (tone === "busy") statusPill.classList.add("bg-sky-500/10", "text-sky-200");
  else statusPill.classList.add("bg-white/5", "text-slate-300");
}

function setError(message) {
  if (!errorBox) return;

  const text = String(message ?? "").trim();
  if (!text) {
    errorBox.classList.add("hidden");
    errorBox.textContent = "";
    return;
  }

  errorBox.textContent = text;
  errorBox.classList.remove("hidden");
}

function toLocalIsoDate(date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 10);
}

function formatDayTitle(dateText, offset) {
  const date = new Date(`${dateText}T12:00:00`);
  const label = offset === 0 ? "Сегодня" : offset === 1 ? "Завтра" : "День";
  const formatted = date.toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });

  return `${label}, ${formatted}`;
}

function formatHours(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  return Number.isInteger(n) ? `${n} ч` : `${n.toFixed(1)} ч`;
}

function isSameHours(value, expected) {
  return Math.abs((Number(value) || 0) - expected) < 0.001;
}

function isRestAfterNightShift(day, night) {
  return isSameHours(day, 2) && isSameHours(night, 5);
}

function getDisplayName(row) {
  return (
    String(row?.display_name ?? "").trim() ||
    String(row?.position_name ?? "").trim() ||
    `Сотрудник ${String(row?.user_id ?? "").slice(0, 8)}`
  );
}

function getInitials(name) {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  return parts.map((part) => part[0]?.toUpperCase()).join("") || "A";
}

function getShiftInfo(row) {
  const day = Number(row?.day_hours) || 0;
  const night = Number(row?.night_hours) || 0;
  const leave = String(row?.leave_type ?? "").trim();

  if (isRestAfterNightShift(day, night)) {
    return {
      kind: "rest",
      label: "отсыпной",
      tone: "danger",
    };
  }

  if (day > 0 || night > 0) {
    let label = "";
    if (day > 0 && night > 0) label = `${formatHours(day).replace(" ч", "")}/${formatHours(night).replace(" ч", "")}`;
    else if (day > 0) label = `${formatHours(day)} день`;
    else label = `${formatHours(night)} ночь`;

    return {
      kind: "work",
      label,
      tone: "ok",
    };
  }

  if (leave) {
    return {
      kind: "leave",
      label: LEAVE_LABELS[leave] || leave,
      tone: "warn",
    };
  }

  if (row?.has_timesheet) {
    return {
      kind: "off",
      label: "Выходной",
      tone: "neutral",
    };
  }

  return {
    kind: "empty",
    label: "Не заполнено",
    tone: "muted",
  };
}

function createBadge(info) {
  const badge = document.createElement("span");
  badge.className = "inline-flex w-fit max-w-full items-center rounded-full px-3 py-1 text-xs font-semibold ring-1";
  badge.textContent = info.label;

  if (info.tone === "ok") {
    badge.classList.add("bg-emerald-500/10", "text-emerald-200", "ring-emerald-400/20");
  } else if (info.tone === "danger") {
    badge.classList.add("bg-rose-500/10", "text-rose-200", "ring-rose-400/20");
  } else if (info.tone === "warn") {
    badge.classList.add("bg-amber-500/10", "text-amber-200", "ring-amber-400/20");
  } else if (info.tone === "muted") {
    badge.classList.add("bg-slate-500/10", "text-slate-400", "ring-white/10");
  } else {
    badge.classList.add("bg-white/5", "text-slate-300", "ring-white/10");
  }

  return badge;
}

function createPersonRow(row) {
  const info = getShiftInfo(row);
  const name = getDisplayName(row);

  const item = document.createElement("div");
  item.className = "flex min-w-0 items-center gap-3 rounded-2xl bg-slate-950/25 p-3 ring-1 ring-white/10";
  if (info.kind === "rest") {
    item.className = "flex min-w-0 items-center gap-3 rounded-2xl bg-rose-500/10 p-3 ring-1 ring-rose-400/20";
  }

  const avatar = document.createElement("div");
  avatar.className =
    "grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-2xl bg-indigo-500/15 text-sm font-bold text-indigo-100 ring-1 ring-indigo-400/25";

  const avatarUrl = String(row?.avatar_url ?? "").trim();
  if (avatarUrl) {
    const img = document.createElement("img");
    img.src = avatarUrl;
    img.alt = "";
    img.className = "h-full w-full object-cover";
    img.addEventListener("error", () => {
      img.remove();
      avatar.textContent = getInitials(name);
    });
    avatar.appendChild(img);
  } else {
    avatar.textContent = getInitials(name);
  }

  const body = document.createElement("div");
  body.className = "min-w-0 flex-1 overflow-hidden";

  const top = document.createElement("div");
  top.className = "grid min-w-0 gap-2";

  const title = document.createElement("div");
  title.className = "block min-w-0 max-w-full truncate text-sm font-semibold text-slate-100";
  title.textContent = name;
  title.title = name;

  top.append(title, createBadge(info));

  const meta = document.createElement("div");
  meta.className = "mt-1 min-w-0 max-w-full truncate text-xs text-slate-400";
  meta.textContent = [row?.position_name, row?.tab_number ? `Таб. № ${row.tab_number}` : ""]
    .filter(Boolean)
    .join(" • ") || "Сотрудник отдела";
  meta.title = meta.textContent;

  body.append(top, meta);
  item.append(avatar, body);
  return item;
}

function groupRowsByDate(list) {
  const map = new Map();
  for (const row of list) {
    const key = String(row.target_date || "");
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function createDayCard(dateText, dateRows, offset) {
  const working = dateRows.filter((row) => getShiftInfo(row).kind === "work");
  const restCount = dateRows.filter((row) => getShiftInfo(row).kind === "rest").length;
  const hideRest = hideRestCheckbox?.checked === true;
  const other = dateRows.filter((row) => {
    const info = getShiftInfo(row);
    if (info.kind === "work") return false;
    if (hideRest && info.kind === "rest") return false;
    return true;
  });
  const hiddenRestCount = hideRest
    ? dateRows.filter((row) => getShiftInfo(row).kind === "rest").length
    : 0;

  const card = document.createElement("article");
  card.className = "glass-card rounded-3xl p-5 md:p-6";

  const head = document.createElement("div");
  head.className = "flex flex-wrap items-start justify-between gap-3";

  const titleWrap = document.createElement("div");
  const title = document.createElement("h2");
  title.className = "text-xl font-semibold text-slate-100";
  title.textContent = formatDayTitle(dateText, offset);

  const subtitle = document.createElement("p");
  subtitle.className = "mt-1 text-sm text-slate-400";
  const baseSubtitle = working.length
    ? `На смене: ${working.length}`
    : "По табелю на смене никого нет";
  subtitle.textContent = restCount ? `${baseSubtitle} • отсыпной: ${restCount}` : baseSubtitle;

  titleWrap.append(title, subtitle);

  const counter = document.createElement("div");
  counter.className = "rounded-2xl bg-emerald-500/10 px-4 py-2 text-2xl font-bold text-emerald-200 ring-1 ring-emerald-400/20";
  counter.textContent = String(working.length);

  head.append(titleWrap, counter);
  card.appendChild(head);

  const workBlock = document.createElement("div");
  workBlock.className = "mt-5 grid gap-3";

  if (working.length) {
    working.forEach((row) => workBlock.appendChild(createPersonRow(row)));
  } else {
    const empty = document.createElement("div");
    empty.className = "rounded-2xl bg-slate-950/25 p-4 text-sm text-slate-400 ring-1 ring-white/10";
    empty.textContent = "Рабочих смен не найдено.";
    workBlock.appendChild(empty);
  }

  card.appendChild(workBlock);

  if (other.length) {
    const details = document.createElement("details");
    details.className = "mt-4 rounded-2xl bg-white/[0.03] p-3 ring-1 ring-white/10";

    const summary = document.createElement("summary");
    summary.className = "cursor-pointer text-sm font-semibold text-slate-300";
    summary.textContent = hiddenRestCount
      ? `Остальные сотрудники: ${other.length} • отсыпной скрыт: ${hiddenRestCount}`
      : `Остальные сотрудники: ${other.length}`;

    const otherList = document.createElement("div");
    otherList.className = "mt-3 grid gap-3";
    other.forEach((row) => otherList.appendChild(createPersonRow(row)));

    details.append(summary, otherList);
    card.appendChild(details);
  }

  return card;
}

function render() {
  if (!daysGrid) return;
  daysGrid.innerHTML = "";

  const grouped = groupRowsByDate(rows);
  const dates = [...grouped.keys()].sort();

  if (!rows.length || !dates.length) {
    emptyState?.classList.remove("hidden");
    return;
  }

  emptyState?.classList.add("hidden");

  const first = rows[0];
  if (departmentLabel) {
    departmentLabel.textContent = first?.department_name
      ? `Отдел: ${first.department_name}`
      : "Отдел найден";
  }

  const uniqueUsers = new Set(rows.map((row) => row.user_id).filter(Boolean));
  if (departmentCount) departmentCount.textContent = String(uniqueUsers.size);

  const todayRows = grouped.get(dates[0]) || [];
  const tomorrowRows = grouped.get(dates[1]) || [];
  if (todayWorkCount) todayWorkCount.textContent = String(todayRows.filter((row) => getShiftInfo(row).kind === "work").length);
  if (tomorrowWorkCount) tomorrowWorkCount.textContent = String(tomorrowRows.filter((row) => getShiftInfo(row).kind === "work").length);

  dates.forEach((dateText, index) => {
    daysGrid.appendChild(createDayCard(dateText, grouped.get(dateText) || [], index));
  });
}

function initRestFilter() {
  if (!hideRestCheckbox) return;
  hideRestCheckbox.checked = localStorage.getItem(HIDE_REST_KEY) === "1";
  hideRestCheckbox.addEventListener("change", () => {
    localStorage.setItem(HIDE_REST_KEY, hideRestCheckbox.checked ? "1" : "0");
    render();
  });
}

function mapError(error) {
  const message = String(error?.message || "");

  if (message.includes("NO_SESSION")) return "Сессия истекла. Войдите заново.";
  if (message.includes("ACCESS_DENIED")) return "Недостаточно прав для просмотра этого отдела.";
  if (message.includes("DEPARTMENT_NOT_FOUND")) return "Для вашего аккаунта пока не найден отдел.";
  if (message.includes("list_department_shift_overview") || message.includes("function")) {
    return "В базе пока нет функции графика. Запустите supabase-sql/005_shift_overview_and_department_invites.sql в Supabase SQL Editor.";
  }

  return message || "Не удалось загрузить смены.";
}

async function loadSchedule() {
  if (isLoading) return;

  isLoading = true;
  if (refreshBtn) refreshBtn.disabled = true;

  try {
    setStatus("Загружаю смены…", "busy");
    setError(null);

    rows = await listDepartmentShiftOverview({
      startDate: toLocalIsoDate(new Date()),
      days: 2,
    });

    render();

    const now = new Date();
    if (updatedAtPill) {
      updatedAtPill.textContent = `Обновлено: ${now.toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    }

    setStatus("Готово", "ok");
  } catch (error) {
    setStatus("Ошибка загрузки", "err");
    setError(mapError(error));
  } finally {
    isLoading = false;
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

refreshBtn?.addEventListener("click", () => void loadSchedule());

(async () => {
  try {
    await requireSession();
  } catch {
    location.href = "login.html?next=schedule.html";
    return;
  }

  startPresenceHeartbeat("Смены отдела");
  initRestFilter();
  await loadSchedule();
})();
