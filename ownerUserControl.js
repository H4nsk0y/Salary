import {
  ownerListUserAudit,
  ownerListUserTimesheets,
  ownerRunAccountAction,
  ownerUpdateUserProfile,
} from "./db.js";
import { alertDialog, confirmDialog } from "./modal.js";

const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

const POSITION_OPTIONS = [
  ["", "Не выбрана"],
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
];

const BRANCH_OPTIONS = [
  ["", "Не выбран"],
  ["chateau_alvisa", "CHATEAU ALVISA"],
  ["alvisa_whisky", "ALVISA WHISKY"],
  ["alvisa_beverage", "ALVISA BEVERAGE"],
  ["alvisa_whisky_distillery", "ALVISA WHISKY DISTILLERY"],
  ["kin_wine_cognac_factory", "Винно-коньячный завод «КиН»"],
];

const POSITION_LABELS = new Map(POSITION_OPTIONS);
const BRANCH_LABELS = new Map(BRANCH_OPTIONS);
const LEAVE_CODES = new Map([
  ["vacation", "ОТ"],
  ["vac_paid", "ОТ"],
  ["vac_unpaid", "ОД"],
  ["vac_unpaid_required", "ОЗ"],
  ["sick", "Б"],
  ["edu_paid", "У"],
  ["edu_unpaid", "УД"],
  ["not_employed", "НТ"],
  ["dismissed", "УВ"],
]);

function byId(id) {
  return document.getElementById(id);
}

function text(value, className = "") {
  const element = document.createElement("div");
  if (className) element.className = className;
  element.textContent = String(value ?? "");
  return element;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function displayName(row) {
  return String(row?.display_name || row?.position || row?.email || "Сотрудник").trim();
}

function initials(value) {
  const parts = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "С";
}

function formatMoney(value) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(number)} ₽`;
}

function formatDate(value, withTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU", withTime
    ? { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "2-digit", year: "numeric" });
}

function isBlocked(row) {
  const timestamp = new Date(row?.banned_until || 0).getTime();
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function sumNumbers(values) {
  return normalizeArray(values).reduce((total, value) => {
    const number = Number(value);
    return total + (Number.isFinite(number) ? number : 0);
  }, 0);
}

function getPaymentInfo(payload) {
  const actual = payload?.paySummary?.actual;
  const calculated = payload?.paySummary?.calculated || payload?.paySummary;
  const actualNet = Number(actual?.net);
  const actualAdvance = Number(actual?.advance);
  const actualRemaining = Number(actual?.remaining);
  const hasConfirmedActual = Boolean(actual?.confirmedAt) && (
    Number.isFinite(actualNet) || Number.isFinite(actualAdvance) || Number.isFinite(actualRemaining)
  );

  if (hasConfirmedActual) {
    const net = Number.isFinite(actualNet)
      ? actualNet
      : (Number.isFinite(actualAdvance) ? actualAdvance : 0) + (Number.isFinite(actualRemaining) ? actualRemaining : 0);
    return { value: net, label: "Фактическая выплата" };
  }

  const calculatedNet = Number(calculated?.net);
  return {
    value: Number.isFinite(calculatedNet) ? calculatedNet : null,
    label: "Расчётная выплата",
  };
}

function leaveCode(value) {
  const normalized = String(value || "").trim();
  return LEAVE_CODES.get(normalized) || normalized.toUpperCase();
}

function createInfoItem(label, value, tone = "neutral") {
  const item = document.createElement("div");
  item.className = "rounded-2xl bg-white/[0.035] p-3 ring-1 ring-white/10";
  const labelEl = text(label, "text-[11px] uppercase text-slate-500");
  const valueEl = text(value || "—", "mt-1 break-words text-sm font-medium");
  valueEl.classList.add(
    tone === "danger" ? "text-rose-200" :
      tone === "ok" ? "text-emerald-200" :
        tone === "warn" ? "text-amber-200" : "text-slate-200"
  );
  item.append(labelEl, valueEl);
  return item;
}

function fillSelect(select, options) {
  if (!select) return;
  select.innerHTML = "";
  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }
}

function accountErrorMessage(error) {
  const message = String(error?.message || "");
  if (message.includes("NO_SESSION")) return "Сессия истекла. Войдите заново.";
  if (message.includes("ACCESS_DENIED")) return "Недостаточно прав для этого действия.";
  if (message.includes("SELF_ACTION_DENIED")) return "Нельзя выполнить это действие со своей текущей учётной записью.";
  if (message.includes("OWNER_ACTION_DENIED")) return "Защитные действия против owner-аккаунта запрещены.";
  if (message.includes("USER_NOT_FOUND")) return "Пользователь не найден.";
  if (message.includes("EMAIL_NOT_FOUND")) return "У пользователя не указан email.";
  if (
    message.includes("owner_update_user_profile") ||
    message.includes("owner_list_user_timesheets") ||
    message.includes("owner_list_user_audit") ||
    message.includes("service_owner_") ||
    message.includes("PGRST202")
  ) {
    return "Запустите supabase-sql/016_owner_user_control_center.sql в Supabase SQL Editor.";
  }
  if (message.includes("owner-account-admin") || message.includes("Edge Function")) {
    return "Серверная функция управления аккаунтами пока не подключена.";
  }
  return message || "Не удалось выполнить действие.";
}

export function setupOwnerUserControl({
  getUsers,
  getDepartments,
  refreshUsers,
  setStatus,
  setError,
  currentOwnerUserId,
} = {}) {
  const drawer = byId("ownerUserDrawer");
  const backdrop = byId("ownerUserDrawerBackdrop");
  const closeBtn = byId("ownerUserDrawerCloseBtn");
  const avatar = byId("ownerUserDrawerAvatar");
  const title = byId("ownerUserDrawerTitle");
  const subtitle = byId("ownerUserDrawerSubtitle");
  const tabsRoot = byId("ownerUserTabs");
  const tabs = Array.from(document.querySelectorAll("[data-owner-user-tab]"));
  const panels = Array.from(document.querySelectorAll("[data-owner-user-panel]"));
  const summary = byId("ownerUserAccountSummary");
  const form = byId("ownerUserProfileForm");
  const displayNameInput = byId("ownerUserDisplayName");
  const positionSelect = byId("ownerUserPosition");
  const genderSelect = byId("ownerUserGender");
  const tabNumberInput = byId("ownerUserTabNumber");
  const branchSelect = byId("ownerUserBranch");
  const employmentDateInput = byId("ownerUserEmploymentDate");
  const okladInput = byId("ownerUserOklad");
  const saveBtn = byId("ownerUserSaveBtn");
  const recoveryBtn = byId("ownerUserRecoveryBtn");
  const sessionsBtn = byId("ownerUserSessionsBtn");
  const blockBtn = byId("ownerUserBlockBtn");
  const deleteBtn = byId("ownerUserDeleteBtn");
  const protectedHint = byId("ownerUserProtectedHint");
  const previewContent = byId("ownerUserPreviewContent");
  const timesheetsList = byId("ownerUserTimesheetsList");
  const auditList = byId("ownerUserAuditList");
  const auditHeading = byId("ownerUserAuditHeading");
  const auditLogBtn = byId("auditLogBtn");

  if (!drawer) return { openUser() {}, openAudit() {} };

  fillSelect(positionSelect, POSITION_OPTIONS);
  fillSelect(branchSelect, BRANCH_OPTIONS);

  let currentUser = null;
  let currentTab = "overview";
  let previousBodyOverflow = "";
  let accountBusy = false;
  const timesheetsCache = new Map();
  const auditCache = new Map();

  const getCurrentUser = () => {
    if (!currentUser?.user_id) return currentUser;
    return getUsers?.().find((row) => row.user_id === currentUser.user_id) || currentUser;
  };

  function renderAvatar(row, globalAudit = false) {
    if (!avatar) return;
    avatar.innerHTML = "";
    if (globalAudit) {
      avatar.textContent = "Ж";
      return;
    }

    const avatarUrl = String(row?.avatar_url || "").trim();
    if (!avatarUrl) {
      avatar.textContent = initials(displayName(row));
      return;
    }

    const image = document.createElement("img");
    image.src = avatarUrl;
    image.alt = "";
    image.className = "h-full w-full object-cover";
    image.addEventListener("error", () => {
      image.remove();
      avatar.textContent = initials(displayName(row));
    });
    avatar.appendChild(image);
  }

  function renderHeader() {
    const row = getCurrentUser();
    const globalAudit = !row;
    renderAvatar(row, globalAudit);
    if (title) title.textContent = globalAudit ? "Журнал действий" : displayName(row);
    if (subtitle) {
      subtitle.textContent = globalAudit
        ? "Все административные изменения"
        : [row?.email, row?.department_name || "Без отдела"].filter(Boolean).join(" • ");
    }
  }

  function setAccountButtonsBusy(nextBusy) {
    accountBusy = Boolean(nextBusy);
    for (const button of [saveBtn, recoveryBtn, sessionsBtn, blockBtn, deleteBtn]) {
      if (button) button.disabled = accountBusy || button.dataset.protected === "true";
    }
  }

  function renderOverview() {
    const row = getCurrentUser();
    if (!row) return;
    currentUser = row;
    renderHeader();

    if (summary) {
      summary.innerHTML = "";
      summary.append(
        createInfoItem("Email", row.email || "—"),
        createInfoItem("Оклад", formatMoney(row.oklad)),
        createInfoItem("Отдел", row.department_name || "Без отдела", row.department_key ? "ok" : "warn"),
        createInfoItem("Последний вход", formatDate(row.last_sign_in_at, true)),
        createInfoItem("Активные сессии", String(row.active_session_count ?? 0)),
        createInfoItem("Push", row.push_enabled ? "Подключены" : "Не подключены", row.push_enabled ? "ok" : "neutral"),
        createInfoItem("Статус входа", isBlocked(row) ? "Заблокирован" : "Разрешён", isBlocked(row) ? "danger" : "ok"),
        createInfoItem("Табелей", String(row.timesheet_count ?? 0)),
        createInfoItem("Роль", row.role || "user")
      );
    }

    if (displayNameInput) displayNameInput.value = row.display_name || "";
    if (positionSelect) positionSelect.value = row.position || "";
    if (genderSelect) genderSelect.value = row.gender || "";
    if (tabNumberInput) tabNumberInput.value = row.tab_number || "";
    if (branchSelect) branchSelect.value = row.branch || "";
    if (employmentDateInput) employmentDateInput.value = row.employment_date || "";
    if (okladInput) okladInput.value = row.oklad == null ? "" : String(row.oklad);

    const protectedAccount = row.user_id === currentOwnerUserId || row.role === "owner";
    for (const button of [sessionsBtn, blockBtn, deleteBtn]) {
      if (!button) continue;
      button.dataset.protected = String(protectedAccount);
      button.disabled = accountBusy || protectedAccount;
    }
    if (recoveryBtn) recoveryBtn.disabled = accountBusy || !row.email;
    if (saveBtn) saveBtn.disabled = accountBusy;
    if (blockBtn) blockBtn.textContent = isBlocked(row) ? "Разблокировать вход" : "Заблокировать вход";
    protectedHint?.classList.toggle("hidden", !protectedAccount);
    if (protectedHint) {
      protectedHint.textContent = protectedAccount
        ? "Блокировка, завершение сессий и удаление owner-аккаунта защищены."
        : "";
    }
  }

  function createPreviewSection(label, description, available = true) {
    const item = document.createElement("div");
    item.className = "flex items-start justify-between gap-4 border-b border-white/10 py-3 last:border-b-0";
    const content = document.createElement("div");
    content.append(
      text(label, "text-sm font-semibold text-slate-100"),
      text(description, "mt-1 text-xs leading-5 text-slate-400")
    );
    const state = text(available ? "Доступно" : "Недоступно", available ? "text-xs font-semibold text-emerald-200" : "text-xs font-semibold text-slate-500");
    item.append(content, state);
    return item;
  }

  function renderPreview() {
    const row = getCurrentUser();
    if (!row || !previewContent) return;
    previewContent.innerHTML = "";

    const identity = document.createElement("section");
    identity.append(
      text("Личный кабинет", "text-base font-semibold text-slate-100"),
      text(`${displayName(row)} • ${POSITION_LABELS.get(row.position) || row.position || "Должность не указана"}`, "mt-2 text-sm text-slate-300"),
      text(`${row.department_name || "Без отдела"} • ${BRANCH_LABELS.get(row.branch) || "Филиал не указан"}`, "mt-1 text-xs text-slate-400")
    );

    const money = document.createElement("section");
    money.className = "border-t border-white/10 pt-5";
    money.append(
      text("Денежные данные", "text-base font-semibold text-slate-100"),
      text(
        row.hide_money
          ? "Пользователь включил защиту денежных данных. В его интерфейсе оклад и выплаты скрыты до разблокировки."
          : `Оклад в профиле: ${formatMoney(row.oklad)}.`,
        "mt-2 text-sm leading-6 text-slate-300"
      )
    );

    const sections = document.createElement("section");
    sections.className = "border-t border-white/10 pt-5";
    sections.appendChild(text("Доступные разделы", "mb-2 text-base font-semibold text-slate-100"));
    sections.append(
      createPreviewSection("Калькулятор", "Быстрый расчёт зарплаты."),
      createPreviewSection("Личный табель", "Смены, часы, норма и выплаты."),
      createPreviewSection("Смены", "Состав смены отдела.", Boolean(row.department_key)),
      createPreviewSection("Табель отдела", "Редактирование общего табеля.", normalizeArray(row.editor_department_keys).length > 0),
      createPreviewSection("Профиль и настройки", "Личные данные и уведомления.")
    );

    const recent = document.createElement("section");
    recent.className = "border-t border-white/10 pt-5";
    recent.appendChild(text("Последние табели", "mb-3 text-base font-semibold text-slate-100"));
    const cached = timesheetsCache.get(row.user_id);
    if (!cached) {
      recent.appendChild(text("Загружаю…", "text-sm text-slate-400"));
    } else {
      renderTimesheetRows(cached.slice(0, 3), recent, { compact: true });
    }

    previewContent.append(identity, money, sections, recent);
  }

  function renderMonthCalendar(sheet, container) {
    const payload = sheet?.payload || {};
    const daysInMonth = new Date(sheet.year, sheet.month + 1, 0).getDate();
    const firstWeekday = (new Date(sheet.year, sheet.month, 1).getDay() + 6) % 7;
    const grid = document.createElement("div");
    grid.className = "mt-4 grid grid-cols-7 gap-1.5";

    for (const label of ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]) {
      grid.appendChild(text(label, "pb-1 text-center text-[10px] font-semibold text-slate-500"));
    }
    for (let index = 0; index < firstWeekday; index += 1) {
      grid.appendChild(document.createElement("div"));
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const index = day - 1;
      const dayHours = Number(payload?.dayHours?.[index]) || 0;
      const nightHours = Number(payload?.nightHours?.[index]) || 0;
      const code = leaveCode(payload?.leaveType?.[index]);
      const isHoliday = payload?.isHoliday?.[index] === true;
      const isTransferred = payload?.isTransferredOff?.[index] === true;
      const isShort = payload?.isShortDay?.[index] === true;
      const weekday = new Date(sheet.year, sheet.month, day).getDay();
      const weekend = weekday === 0 || weekday === 6;

      const cell = document.createElement("div");
      cell.className = "min-h-[68px] rounded-xl bg-white/[0.035] p-2 ring-1 ring-white/10";
      if (isHoliday) cell.classList.add("bg-rose-500/10", "ring-rose-400/20");
      else if (isTransferred || weekend) cell.classList.add("bg-sky-500/[0.06]");

      const top = document.createElement("div");
      top.className = "flex items-center justify-between gap-1 text-[10px]";
      top.appendChild(text(String(day), "font-semibold text-slate-300"));
      if (isShort) top.appendChild(text("−1", "text-amber-200"));

      const value = code || (
        dayHours && nightHours ? `${dayHours}/${nightHours}` :
          dayHours ? `${dayHours} Д` :
            nightHours ? `${nightHours} Н` : "—"
      );
      const valueEl = text(value, "mt-2 break-words text-center text-xs font-semibold text-slate-200");
      if (code === "УВ" || code === "НТ") valueEl.classList.add("text-rose-200");
      cell.append(top, valueEl);
      grid.appendChild(cell);
    }

    container.appendChild(grid);
  }

  function renderTimesheetRows(rows, container, { compact = false } = {}) {
    if (!rows.length) {
      container.appendChild(text("Сохранённых табелей пока нет.", "rounded-2xl bg-white/[0.035] p-4 text-sm text-slate-400 ring-1 ring-white/10"));
      return;
    }

    for (const sheet of rows) {
      const payload = sheet?.payload || {};
      const dayHours = sumNumbers(payload.dayHours);
      const nightHours = sumNumbers(payload.nightHours);
      const payment = getPaymentInfo(payload);

      const item = document.createElement("article");
      item.className = "rounded-2xl bg-white/[0.035] p-4 ring-1 ring-white/10";

      const head = document.createElement("div");
      head.className = "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between";
      const info = document.createElement("div");
      info.append(
        text(`${MONTH_NAMES[sheet.month] || "Месяц"} ${sheet.year}`, "text-sm font-semibold text-slate-100"),
        text(`День: ${dayHours} ч • Ночь: ${nightHours} ч • ${payment.label}: ${formatMoney(payment.value)}`, "mt-1 text-xs leading-5 text-slate-400")
      );
      head.appendChild(info);

      if (!compact) {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "self-start rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 ring-1 ring-white/10 hover:bg-white/10";
        toggle.textContent = "Показать дни";
        const details = document.createElement("div");
        details.className = "hidden";
        let rendered = false;
        toggle.addEventListener("click", () => {
          const willOpen = details.classList.contains("hidden");
          details.classList.toggle("hidden", !willOpen);
          toggle.textContent = willOpen ? "Скрыть дни" : "Показать дни";
          if (willOpen && !rendered) {
            renderMonthCalendar(sheet, details);
            rendered = true;
          }
        });
        head.appendChild(toggle);
        item.append(head, details);
      } else {
        item.appendChild(head);
      }

      container.appendChild(item);
    }
  }

  function renderTimesheets(rows) {
    if (!timesheetsList) return;
    timesheetsList.innerHTML = "";
    renderTimesheetRows(rows, timesheetsList);
  }

  async function ensureTimesheets() {
    const row = getCurrentUser();
    if (!row?.user_id) return [];
    if (timesheetsCache.has(row.user_id)) return timesheetsCache.get(row.user_id);

    if (timesheetsList) timesheetsList.innerHTML = '<div class="text-sm text-slate-400">Загружаю табели…</div>';
    try {
      const rows = await ownerListUserTimesheets(row.user_id, 36);
      timesheetsCache.set(row.user_id, rows);
      renderTimesheets(rows);
      renderPreview();
      return rows;
    } catch (error) {
      const message = accountErrorMessage(error);
      if (timesheetsList) timesheetsList.innerHTML = "";
      timesheetsList?.appendChild(text(message, "rounded-2xl bg-rose-500/10 p-4 text-sm text-rose-200 ring-1 ring-rose-400/20"));
      return [];
    }
  }

  function auditActionLabel(action) {
    return ({
      profile_updated: "Изменены данные профиля",
      department_changed: "Изменён отдел",
      editor_granted: "Выданы права редактора",
      editor_revoked: "Сняты права редактора",
      password_recovery_sent: "Отправлено восстановление пароля",
      sessions_revoked: "Завершены активные сессии",
      user_blocked: "Вход заблокирован",
      user_unblocked: "Вход разблокирован",
      user_deleted: "Аккаунт удалён",
    })[action] || action || "Действие";
  }

  function auditDescription(entry) {
    const details = entry?.details || {};
    if (entry.action === "department_changed") {
      const before = details.before ? getDepartments?.().find((item) => item.key === details.before)?.name || details.before : "Без отдела";
      const after = details.after ? getDepartments?.().find((item) => item.key === details.after)?.name || details.after : "Без отдела";
      return `${before} → ${after}`;
    }
    if (entry.action === "editor_granted" || entry.action === "editor_revoked") {
      return getDepartments?.().find((item) => item.key === details.department_key)?.name || details.department_key || "Отдел";
    }
    if (entry.action === "sessions_revoked") {
      return `Завершено сессий: ${Number(details.session_count) || 0}`;
    }
    if (entry.action === "profile_updated") {
      const before = details.before || {};
      const after = details.after || {};
      const labels = {
        display_name: "ФИО",
        position: "должность",
        gender: "пол",
        tab_number: "табельный номер",
        branch: "филиал",
        employment_date: "дата трудоустройства",
        oklad: "оклад",
      };
      const changed = Object.keys(labels).filter((key) => String(before[key] ?? "") !== String(after[key] ?? ""));
      return changed.length ? `Поля: ${changed.map((key) => labels[key]).join(", ")}` : "Данные сохранены без видимых изменений";
    }
    return details.email ? `Email: ${details.email}` : "";
  }

  function renderAudit(entries, globalAudit = false) {
    if (!auditList) return;
    auditList.innerHTML = "";
    if (!entries.length) {
      auditList.appendChild(text("Записей пока нет.", "rounded-2xl bg-white/[0.035] p-4 text-sm text-slate-400 ring-1 ring-white/10"));
      return;
    }

    for (const entry of entries) {
      const card = document.createElement("article");
      card.className = "rounded-2xl bg-white/[0.035] p-4 ring-1 ring-white/10";
      const top = document.createElement("div");
      top.className = "flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between";
      const main = document.createElement("div");
      main.append(
        text(auditActionLabel(entry.action), "text-sm font-semibold text-slate-100"),
        text(globalAudit ? `${entry.target_name || "Сотрудник"} • ${entry.actor_name || "Owner"}` : entry.actor_name || "Owner", "mt-1 text-xs text-slate-400")
      );
      top.append(main, text(formatDate(entry.created_at, true), "text-xs text-slate-500"));
      card.appendChild(top);
      const description = auditDescription(entry);
      if (description) card.appendChild(text(description, "mt-3 text-xs leading-5 text-slate-300"));
      auditList.appendChild(card);
    }
  }

  async function ensureAudit(globalAudit = false, force = false) {
    const row = getCurrentUser();
    const key = globalAudit ? "__global__" : row?.user_id;
    if (!key) return;
    if (!force && auditCache.has(key)) {
      renderAudit(auditCache.get(key), globalAudit);
      return;
    }

    if (auditList) auditList.innerHTML = '<div class="text-sm text-slate-400">Загружаю журнал…</div>';
    try {
      const entries = await ownerListUserAudit(globalAudit ? null : row.user_id, globalAudit ? 200 : 100);
      auditCache.set(key, entries);
      renderAudit(entries, globalAudit);
    } catch (error) {
      if (auditList) auditList.innerHTML = "";
      auditList?.appendChild(text(accountErrorMessage(error), "rounded-2xl bg-rose-500/10 p-4 text-sm text-rose-200 ring-1 ring-rose-400/20"));
    }
  }

  function switchTab(name) {
    currentTab = name;
    for (const tab of tabs) {
      const active = tab.dataset.ownerUserTab === name;
      tab.classList.toggle("bg-indigo-500/15", active);
      tab.classList.toggle("text-indigo-100", active);
      tab.classList.toggle("ring-1", active);
      tab.classList.toggle("ring-indigo-400/25", active);
      tab.classList.toggle("text-slate-400", !active);
    }
    for (const panel of panels) {
      panel.classList.toggle("hidden", panel.dataset.ownerUserPanel !== name);
    }

    if (name === "preview") {
      renderPreview();
      void ensureTimesheets();
    } else if (name === "timesheets") {
      void ensureTimesheets();
    } else if (name === "audit") {
      void ensureAudit(!getCurrentUser());
    }
  }

  function openDrawer() {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    drawer.classList.remove("hidden");
    drawer.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => closeBtn?.focus());
  }

  function closeDrawer() {
    drawer.classList.add("hidden");
    drawer.setAttribute("aria-hidden", "true");
    document.body.style.overflow = previousBodyOverflow;
    currentUser = null;
  }

  function openUser(row, initialTab = "overview") {
    currentUser = row;
    tabsRoot?.classList.remove("hidden");
    for (const tab of tabs) tab.classList.remove("hidden");
    if (auditHeading) auditHeading.textContent = "История сотрудника";
    renderHeader();
    renderOverview();
    renderPreview();
    const cachedTimesheets = timesheetsCache.get(row.user_id);
    if (cachedTimesheets) renderTimesheets(cachedTimesheets);
    else if (timesheetsList) timesheetsList.innerHTML = '<div class="text-sm text-slate-400">Откройте раздел, чтобы загрузить табели.</div>';
    switchTab(initialTab);
    openDrawer();
  }

  function openAudit() {
    currentUser = null;
    for (const tab of tabs) tab.classList.toggle("hidden", tab.dataset.ownerUserTab !== "audit");
    if (auditHeading) auditHeading.textContent = "Все действия owner";
    renderHeader();
    switchTab("audit");
    openDrawer();
  }

  async function refreshCurrentUser() {
    await refreshUsers?.();
    const updated = getUsers?.().find((row) => row.user_id === currentUser?.user_id);
    if (updated) currentUser = updated;
    renderOverview();
    renderPreview();
  }

  async function saveProfile(event) {
    event.preventDefault();
    const row = getCurrentUser();
    if (!row || accountBusy) return;

    const rawOklad = String(okladInput?.value || "").trim().replace(/\s+/g, "").replace(",", ".");
    const parsedOklad = rawOklad ? Number(rawOklad) : null;
    if (rawOklad && (!Number.isFinite(parsedOklad) || parsedOklad < 0)) {
      await alertDialog({ title: "Проверьте оклад", message: "Оклад должен быть положительным числом или пустым полем.", tone: "warning" });
      return;
    }

    setAccountButtonsBusy(true);
    setStatus?.("Сохраняю данные сотрудника…", "busy");
    setError?.(null);
    try {
      await ownerUpdateUserProfile({
        userId: row.user_id,
        displayName: displayNameInput?.value?.trim() || null,
        position: positionSelect?.value || null,
        gender: genderSelect?.value || null,
        tabNumber: tabNumberInput?.value?.trim() || null,
        branch: branchSelect?.value || null,
        employmentDate: employmentDateInput?.value || null,
        oklad: parsedOklad,
      });
      auditCache.delete(row.user_id);
      auditCache.delete("__global__");
      await refreshCurrentUser();
      setStatus?.("Профиль сотрудника обновлён", "ok");
    } catch (error) {
      setStatus?.("Ошибка", "err");
      setError?.(accountErrorMessage(error));
    } finally {
      setAccountButtonsBusy(false);
      renderOverview();
    }
  }

  async function runAuthAction(action, confirmation) {
    const row = getCurrentUser();
    if (!row || accountBusy) return null;

    const confirmed = await confirmDialog(confirmation);
    if (!confirmed) return null;

    setAccountButtonsBusy(true);
    setStatus?.("Выполняю действие с аккаунтом…", "busy");
    setError?.(null);
    try {
      const result = await ownerRunAccountAction({
        action,
        userId: row.user_id,
        redirectTo: new URL("login.html", window.location.href).toString(),
      });
      auditCache.delete(row.user_id);
      auditCache.delete("__global__");
      return result;
    } catch (error) {
      const message = accountErrorMessage(error);
      setStatus?.("Ошибка", "err");
      setError?.(message);
      await alertDialog({ title: "Действие не выполнено", message, tone: "danger" });
      return null;
    } finally {
      setAccountButtonsBusy(false);
    }
  }

  form?.addEventListener("submit", (event) => void saveProfile(event));
  tabs.forEach((tab) => tab.addEventListener("click", () => switchTab(tab.dataset.ownerUserTab)));
  closeBtn?.addEventListener("click", closeDrawer);
  backdrop?.addEventListener("click", closeDrawer);
  auditLogBtn?.addEventListener("click", openAudit);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !drawer.classList.contains("hidden")) closeDrawer();
  });

  recoveryBtn?.addEventListener("click", async () => {
    const row = getCurrentUser();
    const result = await runAuthAction("send_recovery", {
      title: "Отправить восстановление пароля?",
      message: `Письмо будет отправлено на ${row?.email || "email сотрудника"}.`,
      confirmText: "Отправить",
      cancelText: "Отмена",
      tone: "info",
    });
    if (!result) return;
    await refreshCurrentUser();
    setStatus?.("Письмо для восстановления отправлено", "ok");
  });

  sessionsBtn?.addEventListener("click", async () => {
    const row = getCurrentUser();
    const result = await runAuthAction("revoke_sessions", {
      title: "Завершить все сессии?",
      message: `${displayName(row)} будет выведен из аккаунта на всех устройствах.`,
      note: "Уже выданный короткий токен может действовать ещё несколько минут.",
      confirmText: "Завершить",
      cancelText: "Отмена",
      tone: "warning",
    });
    if (!result) return;
    await refreshCurrentUser();
    setStatus?.(`Завершено сессий: ${Number(result.sessionCount) || 0}`, "ok");
  });

  blockBtn?.addEventListener("click", async () => {
    const row = getCurrentUser();
    const blocked = isBlocked(row);
    const result = await runAuthAction(blocked ? "unblock" : "block", {
      title: blocked ? "Разблокировать вход?" : "Заблокировать вход?",
      message: blocked
        ? `${displayName(row)} снова сможет войти в аккаунт.`
        : `${displayName(row)} потеряет доступ, активные сессии будут завершены.`,
      confirmText: blocked ? "Разблокировать" : "Заблокировать",
      cancelText: "Отмена",
      tone: blocked ? "info" : "danger",
    });
    if (!result) return;
    await refreshCurrentUser();
    setStatus?.(blocked ? "Вход разблокирован" : "Вход заблокирован", "ok");
  });

  deleteBtn?.addEventListener("click", async () => {
    const row = getCurrentUser();
    if (!row || accountBusy) return;
    const first = await confirmDialog({
      title: "Удалить аккаунт?",
      message: `Будут удалены профиль, табели и доступ пользователя "${displayName(row)}".`,
      note: "Это действие нельзя отменить.",
      confirmText: "Продолжить",
      cancelText: "Отмена",
      tone: "danger",
    });
    if (!first) return;

    const result = await runAuthAction("delete", {
      title: "Последнее подтверждение",
      message: `Навсегда удалить аккаунт ${row.email || displayName(row)}?`,
      confirmText: "Удалить навсегда",
      cancelText: "Оставить аккаунт",
      tone: "danger",
    });
    if (!result) return;
    closeDrawer();
    await refreshUsers?.();
    setStatus?.("Аккаунт удалён", "ok");
  });

  return { openUser, openAudit, close: closeDrawer };
}
