import { requireSession, signOut } from "./auth.js";
import {
  getMyProfile,
  listAllDepartments,
  ownerCreateDepartmentInvite,
  ownerListDepartmentInvites,
  ownerListUsers,
  ownerRevokeDepartmentInvite,
  ownerSetDepartmentEditor,
  ownerSetUserDepartment,
} from "./db.js";
import { startPresenceHeartbeat } from "./presence.js";

document.body.classList.add("is-loaded");

const logoutBtn = document.getElementById("logoutBtn");
const refreshBtn = document.getElementById("refreshBtn");
const resetFiltersBtn = document.getElementById("resetFiltersBtn");
const statusPill = document.getElementById("statusPill");
const updatedAtPill = document.getElementById("updatedAtPill");
const errorBox = document.getElementById("errorBox");
const searchInput = document.getElementById("searchInput");
const departmentFilter = document.getElementById("departmentFilter");
const statusFilter = document.getElementById("statusFilter");
const sortSelect = document.getElementById("sortSelect");
const filterHint = document.getElementById("filterHint");
const usersList = document.getElementById("usersList");
const emptyState = document.getElementById("emptyState");
const refreshInvitesBtn = document.getElementById("refreshInvitesBtn");
const inviteDepartmentSelect = document.getElementById("inviteDepartmentSelect");
const inviteDaysInput = document.getElementById("inviteDaysInput");
const inviteMaxUsesInput = document.getElementById("inviteMaxUsesInput");
const createInviteBtn = document.getElementById("createInviteBtn");
const inviteResultBox = document.getElementById("inviteResultBox");
const inviteLinkInput = document.getElementById("inviteLinkInput");
const copyInviteBtn = document.getElementById("copyInviteBtn");
const invitesList = document.getElementById("invitesList");
const invitesEmptyState = document.getElementById("invitesEmptyState");

const totalCount = document.getElementById("totalCount");
const onlineCount = document.getElementById("onlineCount");
const noDepartmentCount = document.getElementById("noDepartmentCount");
const incompleteCount = document.getElementById("incompleteCount");
const editorsCount = document.getElementById("editorsCount");

let departments = [];
let users = [];
let filteredUsers = [];
let invites = [];
let isLoading = false;
let isInvitesLoading = false;
const busyUserIds = new Set();

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
    return;
  }

  errorBox.classList.remove("hidden");
  errorBox.textContent = msg;
}

function text(value, className = "") {
  const el = document.createElement("div");
  if (className) el.className = className;
  el.textContent = value;
  return el;
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item ?? "")).filter(Boolean);
  if (!value) return [];

  return String(value)
    .replace(/^\{|\}$/g, "")
    .split(",")
    .map((item) => item.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function getDisplayName(row) {
  return (
    String(row?.display_name ?? "").trim() ||
    String(row?.position ?? "").trim() ||
    `Сотрудник ${String(row?.user_id ?? "").slice(0, 8)}`
  );
}

function getInitials(name) {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  const initials = parts.map((part) => part[0]?.toUpperCase()).join("");
  return initials || "A";
}

function formatDateTime(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelative(value) {
  if (!value) return "Нет активности";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Нет активности";

  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 10) return "только что";
  if (seconds < 60) return `${seconds} сек назад`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} мин назад`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;

  const days = Math.round(hours / 24);
  return `${days} дн назад`;
}

function createBadge(label, tone = "neutral") {
  const badge = document.createElement("span");
  badge.className = "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1";
  badge.textContent = label;

  if (tone === "ok") {
    badge.classList.add("bg-emerald-500/10", "text-emerald-200", "ring-emerald-400/20");
  } else if (tone === "warn") {
    badge.classList.add("bg-amber-500/10", "text-amber-200", "ring-amber-400/20");
  } else if (tone === "danger") {
    badge.classList.add("bg-rose-500/10", "text-rose-200", "ring-rose-400/20");
  } else if (tone === "sky") {
    badge.classList.add("bg-sky-500/10", "text-sky-200", "ring-sky-400/20");
  } else if (tone === "indigo") {
    badge.classList.add("bg-indigo-500/10", "text-indigo-200", "ring-indigo-400/20");
  } else {
    badge.classList.add("bg-white/5", "text-slate-300", "ring-white/10");
  }

  return badge;
}

function createAvatar(row, displayName) {
  const wrap = document.createElement("div");
  wrap.className =
    "grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-indigo-500/15 text-base font-bold text-indigo-100 ring-1 ring-indigo-400/25";

  const avatarUrl = String(row?.avatar_url ?? "").trim();
  if (!avatarUrl) {
    wrap.textContent = getInitials(displayName);
    return wrap;
  }

  const img = document.createElement("img");
  img.src = avatarUrl;
  img.alt = "";
  img.className = "h-full w-full object-cover";
  img.addEventListener("error", () => {
    img.remove();
    wrap.textContent = getInitials(displayName);
  });

  wrap.appendChild(img);
  return wrap;
}

function getDepartmentName(key) {
  const department = departments.find((item) => item.key === key);
  return department?.name || key || "Без отдела";
}

function isEditorInPrimaryDepartment(row) {
  const key = String(row?.department_key ?? "");
  if (!key) return false;
  return normalizeArray(row?.editor_department_keys).includes(key);
}

function isAnyEditor(row) {
  return normalizeArray(row?.editor_department_keys).length > 0;
}

function isProfileComplete(row) {
  return row?.profile_complete === true;
}

function getSearchBlob(row) {
  return [
    row?.user_id,
    row?.display_name,
    row?.position,
    row?.tab_number,
    row?.role,
    row?.department_key,
    row?.department_name,
    ...normalizeArray(row?.editor_department_names),
  ]
    .join(" ")
    .toLowerCase();
}

function currentFilters() {
  return {
    search: String(searchInput?.value || "").trim().toLowerCase(),
    department: String(departmentFilter?.value || ""),
    status: String(statusFilter?.value || "all"),
    sort: String(sortSelect?.value || "smart"),
  };
}

function applyFilters() {
  const filters = currentFilters();

  filteredUsers = users.filter((row) => {
    if (filters.search && !getSearchBlob(row).includes(filters.search)) return false;

    if (filters.department === "__none" && row.department_key) return false;
    if (filters.department && filters.department !== "__none" && row.department_key !== filters.department) {
      return false;
    }

    if (filters.status === "online" && row.is_online !== true) return false;
    if (filters.status === "offline" && row.is_online === true) return false;
    if (filters.status === "incomplete" && isProfileComplete(row)) return false;
    if (filters.status === "no_department" && row.department_key) return false;
    if (filters.status === "editors" && !isAnyEditor(row)) return false;
    if (filters.status === "owners" && row.role !== "owner") return false;

    return true;
  });

  sortUsers(filteredUsers, filters.sort);
}

function sortUsers(list, mode) {
  const collator = new Intl.Collator("ru-RU", { sensitivity: "base" });

  list.sort((a, b) => {
    if (mode === "name") {
      return collator.compare(getDisplayName(a), getDisplayName(b));
    }

    if (mode === "department") {
      return (
        collator.compare(a.department_name || "яяя", b.department_name || "яяя") ||
        collator.compare(getDisplayName(a), getDisplayName(b))
      );
    }

    if (mode === "last_seen") {
      return new Date(b.last_seen || 0).getTime() - new Date(a.last_seen || 0).getTime();
    }

    if (mode === "created") {
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    }

    return (
      Number(b.is_online === true) - Number(a.is_online === true) ||
      Number(!isProfileComplete(b)) - Number(!isProfileComplete(a)) ||
      collator.compare(a.department_name || "яяя", b.department_name || "яяя") ||
      collator.compare(getDisplayName(a), getDisplayName(b))
    );
  });
}

function updateMetrics() {
  const editorUsersCount = users.filter(isAnyEditor).length;

  if (totalCount) totalCount.textContent = String(users.length);
  if (onlineCount) onlineCount.textContent = String(users.filter((row) => row.is_online === true).length);
  if (noDepartmentCount) noDepartmentCount.textContent = String(users.filter((row) => !row.department_key).length);
  if (incompleteCount) incompleteCount.textContent = String(users.filter((row) => !isProfileComplete(row)).length);
  if (editorsCount) editorsCount.textContent = String(editorUsersCount);
}

function updateFilterHint() {
  if (!filterHint) return;

  const total = users.length;
  const shown = filteredUsers.length;
  filterHint.textContent = total
    ? `Показано ${shown} из ${total}`
    : "Пользователи пока не загружены";
}

function renderDepartmentFilter() {
  if (!departmentFilter) return;

  const selected = departmentFilter.value;
  departmentFilter.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "Все отделы";
  departmentFilter.appendChild(allOption);

  const noDepartmentOption = document.createElement("option");
  noDepartmentOption.value = "__none";
  noDepartmentOption.textContent = "Без отдела";
  departmentFilter.appendChild(noDepartmentOption);

  for (const department of departments) {
    const option = document.createElement("option");
    option.value = department.key;
    option.textContent = department.name || department.key;
    departmentFilter.appendChild(option);
  }

  departmentFilter.value = selected;
}

function renderInviteDepartmentSelect() {
  if (!inviteDepartmentSelect) return;

  const selected = inviteDepartmentSelect.value;
  inviteDepartmentSelect.innerHTML = "";

  for (const department of departments) {
    const option = document.createElement("option");
    option.value = department.key;
    option.textContent = department.name || department.key;
    inviteDepartmentSelect.appendChild(option);
  }

  if (selected && departments.some((department) => department.key === selected)) {
    inviteDepartmentSelect.value = selected;
  }
}

function buildInviteUrl(token) {
  const url = new URL("login.html", window.location.href);
  url.searchParams.set("mode", "signup");
  url.searchParams.set("invite", String(token ?? "").trim());
  url.searchParams.set("next", "profile.html");
  return url.toString();
}

function formatInviteDate(value) {
  if (!value) return "без срока";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "без срока";

  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getInviteStatus(invite) {
  if (invite?.revoked_at) return { label: "отозвано", tone: "danger" };
  if (invite?.is_active === true) return { label: "активно", tone: "ok" };
  return { label: "истекло", tone: "neutral" };
}

function createInviteCard(invite) {
  const card = document.createElement("div");
  card.className = "rounded-3xl bg-slate-950/25 p-4 ring-1 ring-white/10";

  const top = document.createElement("div");
  top.className = "flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between";

  const main = document.createElement("div");
  const title = document.createElement("div");
  title.className = "font-semibold text-slate-100";
  title.textContent = invite.department_name || invite.department_key || "Отдел";

  const meta = document.createElement("div");
  meta.className = "mt-1 text-xs text-slate-400";
  const maxUses = invite.max_uses ? String(invite.max_uses) : "без лимита";
  meta.textContent = `Создано: ${formatInviteDate(invite.created_at)} • До: ${formatInviteDate(invite.expires_at)} • Использовано: ${invite.used_count || 0}/${maxUses}`;

  const status = getInviteStatus(invite);
  main.append(title, meta);

  const actions = document.createElement("div");
  actions.className = "flex flex-wrap items-center gap-2";
  actions.appendChild(createBadge(status.label, status.tone));

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "rounded-2xl bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200 ring-1 ring-white/10 transition-all hover:bg-white/10";
  copyBtn.textContent = "Копировать";
  copyBtn.addEventListener("click", async () => {
    await copyText(buildInviteUrl(invite.token));
    setStatus("Ссылка скопирована", "ok");
  });
  actions.appendChild(copyBtn);

  if (invite.is_active === true) {
    const revokeBtn = document.createElement("button");
    revokeBtn.type = "button";
    revokeBtn.className = "rounded-2xl bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-200 ring-1 ring-rose-400/20 transition-all hover:bg-rose-500/15";
    revokeBtn.textContent = "Отозвать";
    revokeBtn.addEventListener("click", async () => {
      const ok = confirm(`Отозвать приглашение в отдел "${invite.department_name || invite.department_key}"?`);
      if (!ok) return;

      try {
        setStatus("Отзываю приглашение…", "busy");
        await ownerRevokeDepartmentInvite(invite.token);
        await loadInvites({ silent: true });
        setStatus("Приглашение отозвано", "ok");
      } catch (error) {
        setStatus("Ошибка", "err");
        setError(mapError(error));
      }
    });
    actions.appendChild(revokeBtn);
  }

  top.append(main, actions);
  card.appendChild(top);
  return card;
}

function renderInvites() {
  if (invitesList) invitesList.innerHTML = "";

  if (!invites.length) {
    invitesEmptyState?.classList.remove("hidden");
    return;
  }

  invitesEmptyState?.classList.add("hidden");
  const fragment = document.createDocumentFragment();
  invites.forEach((invite) => fragment.appendChild(createInviteCard(invite)));
  invitesList?.appendChild(fragment);
}

function createDepartmentSelect(row, isBusy) {
  const select = document.createElement("select");
  select.className = "ui-select text-sm";
  select.disabled = isBusy;

  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "Без отдела";
  select.appendChild(empty);

  for (const department of departments) {
    const option = document.createElement("option");
    option.value = department.key;
    option.textContent = department.name || department.key;
    select.appendChild(option);
  }

  select.value = String(row.department_key || "");

  select.addEventListener("change", async () => {
    const previous = String(row.department_key || "");
    const next = String(select.value || "");
    if (previous === next) return;

    const displayName = getDisplayName(row);
    const nextLabel = next ? getDepartmentName(next) : "без отдела";
    const ok = confirm(`Перевести "${displayName}" в "${nextLabel}"?`);
    if (!ok) {
      select.value = previous;
      return;
    }

    await runUserAction(row.user_id, async () => {
      await ownerSetUserDepartment(row.user_id, next || null);
    }, "Отдел сотрудника обновлён");
  });

  return select;
}

function createDetail(label, value) {
  const item = document.createElement("div");
  item.className = "rounded-2xl bg-slate-950/25 p-3 ring-1 ring-white/10";

  const title = document.createElement("div");
  title.className = "text-[11px] uppercase text-slate-500";
  title.textContent = label;

  const body = document.createElement("div");
  body.className = "mt-1 truncate text-sm font-medium text-slate-200";
  body.textContent = value || "—";

  item.append(title, body);
  return item;
}

function createUserCard(row) {
  const displayName = getDisplayName(row);
  const isBusy = busyUserIds.has(row.user_id);
  const editorNames = normalizeArray(row.editor_department_names);
  const primaryEditor = isEditorInPrimaryDepartment(row);
  const complete = isProfileComplete(row);
  const missingFields = normalizeArray(row.missing_fields);

  const card = document.createElement("article");
  card.className = "glass-card rounded-3xl p-5 ring-1 ring-white/10";

  const top = document.createElement("div");
  top.className = "flex gap-4";

  const body = document.createElement("div");
  body.className = "min-w-0 flex-1";

  const nameRow = document.createElement("div");
  nameRow.className = "flex flex-wrap items-center gap-2";

  const name = document.createElement("div");
  name.className = "min-w-0 truncate text-lg font-semibold text-slate-100";
  name.textContent = displayName;

  nameRow.appendChild(name);
  nameRow.appendChild(createBadge(row.is_online ? "онлайн" : "оффлайн", row.is_online ? "ok" : "neutral"));
  if (row.role === "owner") nameRow.appendChild(createBadge("owner", "indigo"));

  const meta = document.createElement("div");
  meta.className = "mt-1 text-sm text-slate-400";
  meta.textContent =
    [row.position, row.tab_number ? `Таб. № ${row.tab_number}` : ""]
      .filter(Boolean)
      .join(" • ") || `ID: ${String(row.user_id).slice(0, 8)}`;

  const badges = document.createElement("div");
  badges.className = "mt-4 flex flex-wrap gap-2";
  badges.appendChild(createBadge(row.department_name || "Без отдела", row.department_key ? "sky" : "warn"));
  badges.appendChild(createBadge(complete ? "Профиль заполнен" : "Профиль не заполнен", complete ? "ok" : "danger"));
  if (editorNames.length) {
    badges.appendChild(createBadge(`Редактор: ${editorNames.join(", ")}`, "indigo"));
  }

  body.append(nameRow, meta, badges);
  top.append(createAvatar(row, displayName), body);

  const details = document.createElement("div");
  details.className = "mt-5 grid gap-3 sm:grid-cols-2";
  details.append(
    createDetail("Активность", `${formatRelative(row.last_seen)}${row.page ? ` • ${row.page}` : ""}`),
    createDetail("Регистрация", formatDateTime(row.created_at)),
    createDetail("Отделов", String(row.department_count ?? 0)),
    createDetail("Роль", row.role || "user")
  );

  const warning = document.createElement("div");
  if (!complete) {
    warning.className = "mt-4 rounded-2xl bg-rose-500/10 p-3 text-xs text-rose-100 ring-1 ring-rose-400/20";
    warning.textContent = `Не хватает: ${missingFields.join(", ") || "обязательных полей"}.`;
  } else {
    warning.className = "hidden";
  }

  const controls = document.createElement("div");
  controls.className = "mt-5 rounded-3xl bg-slate-950/25 p-4 ring-1 ring-white/10";

  const controlsGrid = document.createElement("div");
  controlsGrid.className = "grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]";

  const departmentControl = document.createElement("div");
  const departmentLabel = document.createElement("label");
  departmentLabel.className = "mb-2 block text-xs font-semibold uppercase text-slate-400";
  departmentLabel.textContent = "Отдел";
  const selectWrap = document.createElement("span");
  selectWrap.className = "select-wrap";
  selectWrap.appendChild(createDepartmentSelect(row, isBusy));
  departmentControl.append(departmentLabel, selectWrap);

  const actionStack = document.createElement("div");
  actionStack.className = "flex flex-wrap items-end gap-2";

  const editorBtn = document.createElement("button");
  editorBtn.type = "button";
  editorBtn.disabled = isBusy || !row.department_key;
  editorBtn.className = primaryEditor
    ? "rounded-2xl bg-amber-500/10 px-4 py-2.5 text-sm font-semibold text-amber-200 ring-1 ring-amber-400/20 transition-all hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:opacity-50"
    : "rounded-2xl bg-sky-500/10 px-4 py-2.5 text-sm font-semibold text-sky-200 ring-1 ring-sky-400/20 transition-all hover:bg-sky-500/15 disabled:cursor-not-allowed disabled:opacity-50";
  editorBtn.textContent = row.department_key
    ? primaryEditor ? "Снять редактора" : "Сделать редактором"
    : "Сначала отдел";
  editorBtn.addEventListener("click", async () => {
    if (!row.department_key) return;

    const next = !primaryEditor;
    const ok = confirm(
      next
        ? `Назначить "${displayName}" редактором отдела "${row.department_name || row.department_key}"?`
        : `Снять права редактора у "${displayName}"?`
    );
    if (!ok) return;

    await runUserAction(row.user_id, async () => {
      await ownerSetDepartmentEditor(row.department_key, row.user_id, next);
    }, next ? "Редактор назначен" : "Права редактора сняты");
  });

  actionStack.appendChild(editorBtn);

  if (row.department_key) {
    const timesheetLink = document.createElement("a");
    timesheetLink.href = `admin.html?department=${encodeURIComponent(row.department_key)}`;
    timesheetLink.className =
      "rounded-2xl bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 ring-1 ring-white/15 transition-all hover:bg-white/10";
    timesheetLink.textContent = "Табель отдела";
    actionStack.appendChild(timesheetLink);
  }

  controlsGrid.append(departmentControl, actionStack);
  controls.appendChild(controlsGrid);

  card.append(top, details, warning, controls);
  return card;
}

function renderUsers() {
  applyFilters();
  updateMetrics();
  updateFilterHint();

  if (usersList) usersList.innerHTML = "";

  if (!filteredUsers.length) {
    emptyState?.classList.remove("hidden");
    return;
  }

  emptyState?.classList.add("hidden");
  const fragment = document.createDocumentFragment();
  filteredUsers.forEach((row) => fragment.appendChild(createUserCard(row)));
  usersList?.appendChild(fragment);
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

function mapError(error) {
  const message = String(error?.message || "");

  if (message.includes("NO_SESSION")) return "Сессия истекла. Войдите заново.";
  if (message.includes("ACCESS_DENIED")) return "Недостаточно прав для этого действия.";
  if (message.includes("USER_NOT_FOUND")) return "Пользователь не найден.";
  if (message.includes("DEPARTMENT_NOT_FOUND")) return "Отдел не найден.";
  if (message.includes("USER_NOT_IN_DEPARTMENT")) return "Сначала добавьте сотрудника в этот отдел.";
  if (message.includes("INVITE_NOT_FOUND")) return "Приглашение не найдено.";
  if (message.includes("INVITE_REVOKED")) return "Приглашение уже отозвано.";
  if (message.includes("INVITE_EXPIRED")) return "Срок приглашения истек.";
  if (message.includes("INVITE_USED_UP")) return "Лимит приглашения исчерпан.";
  if (message.includes("department_invites") || message.includes("owner_create_department_invite") || message.includes("gen_random_bytes")) {
    return "Для приглашений нужно запустить supabase-sql/006_fix_invite_permissions_and_pgcrypto.sql в Supabase SQL Editor.";
  }

  return message || "Не удалось выполнить действие.";
}

async function runUserAction(userId, action, successText) {
  busyUserIds.add(userId);
  renderUsers();

  try {
    setStatus("Сохраняю изменения…", "busy");
    setError(null);
    await action();
    await loadUsers({ silent: true });
    setStatus(successText, "ok");
  } catch (error) {
    setStatus("Ошибка", "err");
    setError(mapError(error));
  } finally {
    busyUserIds.delete(userId);
    renderUsers();
  }
}

async function loadUsers(options = {}) {
  if (isLoading) return;

  isLoading = true;
  if (refreshBtn) refreshBtn.disabled = true;

  try {
    if (!options.silent) {
      setStatus("Загружаю пользователей…", "busy");
      setError(null);
    }

    users = await ownerListUsers();
    renderUsers();

    const now = new Date();
    if (updatedAtPill) {
      updatedAtPill.textContent = `Обновлено: ${now.toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    }

    if (!options.silent) setStatus("Готово", "ok");
  } catch (error) {
    setStatus("Ошибка загрузки", "err");
    setError(mapError(error));
  } finally {
    isLoading = false;
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

async function loadInvites(options = {}) {
  if (isInvitesLoading) return;

  isInvitesLoading = true;
  if (refreshInvitesBtn) refreshInvitesBtn.disabled = true;

  try {
    if (!options.silent) {
      setStatus("Загружаю приглашения…", "busy");
      setError(null);
    }

    invites = await ownerListDepartmentInvites();
    renderInvites();

    if (!options.silent) setStatus("Приглашения загружены", "ok");
  } catch (error) {
    setStatus("Ошибка приглашений", "err");
    setError(mapError(error));
  } finally {
    isInvitesLoading = false;
    if (refreshInvitesBtn) refreshInvitesBtn.disabled = false;
  }
}

async function createInvite() {
  const departmentKey = String(inviteDepartmentSelect?.value || "").trim();
  const expiresInDays = Number(inviteDaysInput?.value || 14);
  const maxUses = Number(inviteMaxUsesInput?.value || 0);

  if (!departmentKey) {
    setError("Выберите отдел для приглашения.");
    return;
  }

  try {
    setStatus("Создаю приглашение…", "busy");
    setError(null);
    if (createInviteBtn) createInviteBtn.disabled = true;

    const invite = await ownerCreateDepartmentInvite({
      departmentKey,
      expiresInDays: Number.isInteger(expiresInDays) ? expiresInDays : 14,
      maxUses: Number.isInteger(maxUses) && maxUses > 0 ? maxUses : null,
    });

    if (!invite?.token) {
      throw new Error("Не удалось получить токен приглашения.");
    }

    const url = buildInviteUrl(invite?.token);
    if (inviteLinkInput) inviteLinkInput.value = url;
    inviteResultBox?.classList.remove("hidden");

    await copyText(url).catch(() => {});
    await loadInvites({ silent: true });
    setStatus("Ссылка создана и скопирована", "ok");
  } catch (error) {
    setStatus("Ошибка", "err");
    setError(mapError(error));
  } finally {
    if (createInviteBtn) createInviteBtn.disabled = false;
  }
}

function bindEvents() {
  logoutBtn?.addEventListener("click", async () => {
    try {
      await signOut();
    } finally {
      location.href = "login.html?next=owner-users.html";
    }
  });

  refreshBtn?.addEventListener("click", () => {
    void loadUsers();
    void loadInvites({ silent: true });
  });
  refreshInvitesBtn?.addEventListener("click", () => void loadInvites());
  createInviteBtn?.addEventListener("click", () => void createInvite());
  copyInviteBtn?.addEventListener("click", async () => {
    const value = String(inviteLinkInput?.value || "").trim();
    if (!value) return;

    try {
      await copyText(value);
      setStatus("Ссылка скопирована", "ok");
    } catch (error) {
      setStatus("Ошибка копирования", "err");
      setError(error?.message || "Не удалось скопировать ссылку.");
    }
  });

  resetFiltersBtn?.addEventListener("click", () => {
    if (searchInput) searchInput.value = "";
    if (departmentFilter) departmentFilter.value = "";
    if (statusFilter) statusFilter.value = "all";
    if (sortSelect) sortSelect.value = "smart";
    renderUsers();
  });

  searchInput?.addEventListener("input", renderUsers);
  departmentFilter?.addEventListener("change", renderUsers);
  statusFilter?.addEventListener("change", renderUsers);
  sortSelect?.addEventListener("change", renderUsers);
}

(async () => {
  try {
    await requireSession();
  } catch {
    location.href = "login.html?next=owner-users.html";
    return;
  }

  try {
    setStatus("Проверяю доступ…", "busy");
    setError(null);

    const profile = await getMyProfile();
    if (profile?.role !== "owner") {
      setStatus("Доступ запрещён", "err");
      setError("Эта страница доступна только овнеру.");
      return;
    }

    startPresenceHeartbeat("Owner: пользователи");
    bindEvents();

    setStatus("Загружаю отделы…", "busy");
    departments = await listAllDepartments();
    renderDepartmentFilter();
    renderInviteDepartmentSelect();

    await Promise.all([
      loadUsers(),
      loadInvites({ silent: true }),
    ]);
  } catch (error) {
    setStatus("Ошибка загрузки", "err");
    setError(mapError(error));
  }
})();
