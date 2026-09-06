import { requireSession } from "./auth.js";
import {
  getMyDepartmentMembershipKey,
  getMyDepartmentKey,
  getMyManagedDepartment,
  getMyProfile,
  listAllDepartments,
  listDepartmentShiftOverview,
} from "./db.js";
import { startPresenceHeartbeat } from "./presence.js";
import {
  loadScheduleContext,
  loadScheduleSnapshot,
  saveScheduleContext,
  saveScheduleSnapshot,
} from "./scheduleCache.js";
import { setUiStatus } from "./uiStatus.js";

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
const departmentSelect = document.getElementById("scheduleDepartmentSelect");
const timesheetLink = document.getElementById("timesheetLink");

let rows = [];
let departments = [];
let selectedDepartmentKey = "";
let currentUserId = "";
let isLoading = false;
let departmentTableAccess = null;
const LEAVE_LABELS = {
  vac_paid: "Отпуск",
  vac_unpaid: "Отпуск без оплаты",
  vac_unpaid_required: "Обязательный отпуск",
  sick: "Больничный",
  edu_paid: "Учебный отпуск",
  edu_unpaid: "Учебный без оплаты",
  not_employed: "Не трудоустроен",
};

const POSITION_LABELS = new Map([
  ["egais_head", "Руководитель отдела ЕГАИС"],
  ["egais_senior_operator", "Старший оператор ЕГАИС"],
  ["egais_operator", "Оператор ЕГАИС"],
  ["warehouse_head", "Руководитель склада"],
  ["storekeeper", "Кладовщик"],
  ["loader", "Грузчик"],
  ["driver", "Водитель"],
  ["bottling_plant_head", "Руководитель цеха розлива"],
  ["shift_senior_master", "Старший мастер смены"],
  ["shift_master", "Мастер смены"],
  ["filling_line_operator", "Оператор линии розлива"],
  ["accountant", "Учетчик"],
  ["laboratory_head", "Руководитель лаборатории"],
  ["deputy_head_laboratory", "Заместитель руководителя лаборатории"],
  ["entrance_control_engineer", "Инженер входного контроля"],
  ["quality_control_engineer", "Инженер контроля качества"],
  ["chemist", "Химик"],
  ["microbiologist", "Микробиолог"],
  ["chief_accountant", "Главный бухгалтер"],
  ["deputy_chief_accountant", "Заместитель главного бухгалтера"],
  ["accountant_bookkeeping", "Бухгалтер"],
  ["system_administrator", "Системный администратор"],
  ["assistant_system_administrator", "Помощник системного администратора"],
  ["hr_service_head", "Руководитель службы персонала"],
  ["hr_specialist", "Специалист по персоналу"],
  ["director", "Директор"],
  ["assistant_director", "Помощник директора"],
  ["procurement_specialist", "Специалист по закупкам"],
  ["technology_accounting_specialist", "Специалист по учету"],
]);

function setStatus(text, tone = "neutral") {
  setUiStatus(statusPill, text, tone, { accent: "ring" });
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

function isNightShiftStart(day, night) {
  return (
    (isSameHours(day, 2) && isSameHours(night, 2)) ||
    (isSameHours(day, 4) && isSameHours(night, 7))
  );
}

function getDisplayName(row) {
  return (
    String(row?.display_name ?? "").trim() ||
    String(row?.position_name ?? "").trim() ||
    `Сотрудник ${String(row?.user_id ?? "").slice(0, 8)}`
  );
}

function getPositionLabel(row) {
  const raw = String(row?.position_name ?? row?.position ?? "").trim();
  if (!raw) return "Сотрудник отдела";
  return POSITION_LABELS.get(raw) || raw;
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

    if (isNightShiftStart(day, night)) {
      return {
        kind: "night-shift",
        label,
        tone: "danger",
      };
    }

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

function isWorkingShift(row) {
  const kind = getShiftInfo(row).kind;
  return kind === "work" || kind === "night-shift";
}

function createBadge(info) {
  const badge = document.createElement("span");
  badge.className = "schedule-shift-badge inline-flex w-fit max-w-full items-center rounded-full px-3 py-1 text-xs font-semibold ring-1";
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
  const isCurrentUser = String(row?.user_id || "") === currentUserId;

  const item = document.createElement("div");
  item.className = "schedule-person flex min-w-0 items-center gap-3 rounded-2xl bg-slate-950/25 p-3 ring-1 ring-white/10";
  if (info.kind === "rest" || info.kind === "night-shift") {
    item.className = "schedule-person is-night flex min-w-0 items-center gap-3 rounded-2xl bg-rose-500/10 p-3 ring-1 ring-rose-400/20";
  }
  if (isCurrentUser) {
    item.classList.remove("ring-1", "ring-white/10", "ring-rose-400/20");
    item.classList.add("ring-2", "ring-indigo-400/60", "shadow-[0_0_24px_rgba(99,102,241,0.12)]");
    item.classList.add("is-self");
  }

  const avatar = document.createElement("div");
  avatar.className =
    "schedule-avatar grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-2xl bg-indigo-500/15 text-sm font-bold text-indigo-100 ring-1 ring-indigo-400/25";

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
  title.className = "schedule-person-name block min-w-0 flex-1 truncate text-sm font-semibold text-slate-100";
  title.textContent = name;
  title.title = name;

  const identity = document.createElement("div");
  identity.className = "flex min-w-0 items-center gap-2";
  identity.appendChild(title);
  if (isCurrentUser) {
    const selfBadge = document.createElement("span");
    selfBadge.className = "shrink-0 rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-bold text-indigo-100 ring-1 ring-indigo-400/30";
    selfBadge.textContent = "Вы";
    identity.appendChild(selfBadge);
  }

  top.append(identity, createBadge(info));

  const meta = document.createElement("div");
  meta.className = "schedule-person-meta mt-1 min-w-0 max-w-full truncate text-xs text-slate-400";
  meta.textContent = getPositionLabel(row);
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
  const working = dateRows.filter(isWorkingShift);
  const restCount = dateRows.filter((row) => getShiftInfo(row).kind === "rest").length;
  const other = dateRows.filter((row) => !isWorkingShift(row));

  const card = document.createElement("article");
  card.className = "schedule-day-card glass-card rounded-3xl p-5 md:p-6";

  const head = document.createElement("div");
  head.className = "flex flex-wrap items-start justify-between gap-3";

  const titleWrap = document.createElement("div");
  const title = document.createElement("h2");
  title.className = "schedule-day-title text-xl font-semibold text-slate-100";
  title.textContent = formatDayTitle(dateText, offset);

  const subtitle = document.createElement("p");
  subtitle.className = "mt-1 text-sm text-slate-400";
  const baseSubtitle = working.length
    ? `На смене: ${working.length}`
    : "По табелю на смене никого нет";
  subtitle.textContent = restCount ? `${baseSubtitle} • отсыпной: ${restCount}` : baseSubtitle;

  titleWrap.append(title, subtitle);

  const counter = document.createElement("div");
  counter.className = "schedule-day-count rounded-2xl bg-emerald-500/10 px-4 py-2 text-2xl font-bold text-emerald-200 ring-1 ring-emerald-400/20";
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
    details.className = "schedule-other mt-4 rounded-2xl bg-white/[0.03] p-3 ring-1 ring-white/10";

    const summary = document.createElement("summary");
    summary.className = "cursor-pointer text-sm font-semibold text-slate-300";
    summary.textContent = `Остальные сотрудники: ${other.length}`;

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

  const selectedDepartment = departments.find((item) => item.key === selectedDepartmentKey);
  if (departmentLabel) {
    departmentLabel.textContent = selectedDepartment
      ? `Отдел: ${selectedDepartment.name || selectedDepartment.key}`
      : "Отдел не выбран";
  }

  const grouped = groupRowsByDate(rows);
  const dates = [...grouped.keys()].sort();

  if (!rows.length || !dates.length) {
    if (todayWorkCount) todayWorkCount.textContent = "0";
    if (tomorrowWorkCount) tomorrowWorkCount.textContent = "0";
    if (departmentCount) departmentCount.textContent = "0";
    if (emptyState) {
      emptyState.textContent = "В выбранном отделе пока нет сотрудников или данных по сменам.";
    }
    emptyState?.classList.remove("hidden");
    return;
  }

  emptyState?.classList.add("hidden");

  const uniqueUsers = new Set(rows.map((row) => row.user_id).filter(Boolean));
  if (departmentCount) departmentCount.textContent = String(uniqueUsers.size);

  const todayRows = grouped.get(dates[0]) || [];
  const tomorrowRows = grouped.get(dates[1]) || [];
  if (todayWorkCount) todayWorkCount.textContent = String(todayRows.filter(isWorkingShift).length);
  if (tomorrowWorkCount) tomorrowWorkCount.textContent = String(tomorrowRows.filter(isWorkingShift).length);

  dates.forEach((dateText, index) => {
    daysGrid.appendChild(createDayCard(dateText, grouped.get(dateText) || [], index));
  });
}

function renderDepartmentSelect() {
  if (!departmentSelect) return;
  departmentSelect.innerHTML = "";

  for (const department of departments) {
    const option = document.createElement("option");
    option.value = department.key;
    option.textContent = department.name || department.key;
    departmentSelect.appendChild(option);
  }

  departmentSelect.value = selectedDepartmentKey;
}

function updateTimesheetLink() {
  if (!timesheetLink) return;

  const accessKey = departmentTableAccess?.owner
    ? selectedDepartmentKey
    : departmentTableAccess?.key;

  if (!accessKey) {
    timesheetLink.href = "table.html";
    timesheetLink.textContent = "Мой табель";
    return;
  }

  timesheetLink.href = `admin.html?department=${encodeURIComponent(accessKey)}`;
  timesheetLink.textContent = "Табель отдела";
}

function updateDepartmentUrl() {
  const url = new URL(window.location.href);
  if (selectedDepartmentKey) url.searchParams.set("department", selectedDepartmentKey);
  else url.searchParams.delete("department");
  history.replaceState(null, "", url.toString());
}

function bindDepartmentSelect() {
  departmentSelect?.addEventListener("change", () => {
    selectedDepartmentKey = String(departmentSelect.value || "").trim();
    saveScheduleContext(currentUserId, departments, selectedDepartmentKey);
    updateDepartmentUrl();
    updateTimesheetLink();
    void loadSchedule();
  });
}

function mapError(error) {
  const message = String(error?.message || "");

  if (message.includes("NO_SESSION")) return "Сессия истекла. Войдите заново.";
  if (message.includes("ACCESS_DENIED")) {
    return "Для просмотра других отделов запустите supabase-sql/017_cross_department_schedule.sql в Supabase SQL Editor.";
  }
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
  const requestedDepartmentKey = selectedDepartmentKey;

  const startDate = toLocalIsoDate(new Date());
  const days = 2;

  try {
    setStatus("Загружаю смены…", "busy");
    setError(null);

    const loadedRows = await listDepartmentShiftOverview({
      departmentKey: requestedDepartmentKey,
      startDate,
      days,
    });

    saveScheduleSnapshot({
      userId: currentUserId,
      departmentKey: requestedDepartmentKey,
      startDate,
      days,
      rows: loadedRows,
    });

    if (requestedDepartmentKey !== selectedDepartmentKey) return;
    rows = loadedRows;
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
    if (requestedDepartmentKey !== selectedDepartmentKey) return;
    const cached = loadScheduleSnapshot({
      userId: currentUserId,
      departmentKey: requestedDepartmentKey,
      startDate,
      days,
    });

    if (cached) {
      rows = cached.rows;
      render();

      const cachedAt = new Date(cached.savedAt);
      const cachedLabel = cachedAt.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });

      if (updatedAtPill) updatedAtPill.textContent = `Кеш: ${cachedLabel}`;
      setStatus("Последние загруженные данные", "warning");
      setError(`Нет доступа к базе, показан последний загруженный график от ${cachedLabel}.`);
    } else {
      rows = [];
      render();
      setStatus("Ошибка загрузки", "err");
      setError(mapError(error));
    }
  } finally {
    isLoading = false;
    if (refreshBtn) refreshBtn.disabled = false;
    if (requestedDepartmentKey !== selectedDepartmentKey) void loadSchedule();
  }
}

refreshBtn?.addEventListener("click", () => void loadSchedule());

(async () => {
  let session;
  try {
    session = await requireSession();
    currentUserId = String(session?.user?.id || "");
  } catch {
    location.href = "login.html?next=schedule.html";
    return;
  }

  startPresenceHeartbeat("Смены отдела");
  setStatus("Загружаю отделы…", "busy");

  try {
    const [departmentRows, myDepartmentKey, profile, managedDepartment, membershipDepartmentKey] = await Promise.all([
      listAllDepartments(),
      getMyDepartmentKey(),
      getMyProfile().catch(() => null),
      getMyManagedDepartment().catch(() => null),
      getMyDepartmentMembershipKey().catch(() => null),
    ]);
    departments = departmentRows ?? [];

    departmentTableAccess = profile?.role === "owner"
      ? { owner: true }
      : managedDepartment?.key
        ? { key: managedDepartment.key }
        : membershipDepartmentKey === "egais"
          ? { key: "egais", readOnly: true }
          : null;

    const requestedKey = new URL(window.location.href).searchParams.get("department") || "";
    selectedDepartmentKey = departments.some((item) => item.key === requestedKey)
      ? requestedKey
      : departments.some((item) => item.key === myDepartmentKey)
        ? myDepartmentKey
        : departments[0]?.key || "";

    renderDepartmentSelect();
    updateTimesheetLink();
    bindDepartmentSelect();
    updateDepartmentUrl();
    saveScheduleContext(currentUserId, departments, selectedDepartmentKey);
  } catch (error) {
    const cachedContext = loadScheduleContext(currentUserId);
    if (!cachedContext) {
      setStatus("Ошибка загрузки", "err");
      setError(mapError(error));
      return;
    }

    departments = cachedContext.departments;
    const requestedKey = new URL(window.location.href).searchParams.get("department") || "";
    selectedDepartmentKey = departments.some((item) => item.key === requestedKey)
      ? requestedKey
      : departments.some((item) => item.key === cachedContext.selectedDepartmentKey)
        ? cachedContext.selectedDepartmentKey
        : departments[0]?.key || "";
    renderDepartmentSelect();
    updateTimesheetLink();
    bindDepartmentSelect();
    updateDepartmentUrl();
  }

  await loadSchedule();
})();
