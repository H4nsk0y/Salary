import { requireSession } from "./auth.js";
import {
  createDepartmentTask,
  deleteDepartmentTask,
  getMyDepartmentKey,
  getMyManagedDepartment,
  getMyProfile,
  listAllDepartments,
  listDepartmentShiftOverview,
  listMyDepartmentTasks,
  ownerListDepartmentMembers,
  sendPushNotifications,
} from "./db.js";
import { confirmDialog } from "./modal.js";
import { startPresenceHeartbeat } from "./presence.js";

const elements = {
  openCreate: document.getElementById("openCreateTaskBtn"),
  closeCreate: document.getElementById("closeCreateTaskBtn"),
  refresh: document.getElementById("refreshTasksBtn"),
  status: document.getElementById("taskStatusPill"),
  updated: document.getElementById("taskUpdatedPill"),
  error: document.getElementById("taskErrorBox"),
  createPanel: document.getElementById("createTaskPanel"),
  createForm: document.getElementById("createTaskForm"),
  department: document.getElementById("taskDepartmentSelect"),
  taskDate: document.getElementById("taskDateInput"),
  dueAt: document.getElementById("taskDueInput"),
  taskText: document.getElementById("taskTextInput"),
  assignmentModes: [...document.querySelectorAll("[data-assignment-mode]")],
  shiftCount: document.getElementById("taskShiftCount"),
  shiftPreview: document.getElementById("taskShiftPreview"),
  selectedBlock: document.getElementById("selectedAssigneesBlock"),
  members: document.getElementById("taskMembersList"),
  selectShift: document.getElementById("selectShiftAssigneesBtn"),
  recipientHint: document.getElementById("taskRecipientHint"),
  createSubmit: document.getElementById("createTaskSubmitBtn"),
  pickerButtons: [...document.querySelectorAll("[data-open-picker]")],
  listTitle: document.getElementById("tasksListTitle"),
  listSubtitle: document.getElementById("tasksListSubtitle"),
  scopeControl: document.getElementById("tasksScopeControl"),
  scopes: [...document.querySelectorAll("[data-task-scope]")],
  departmentFilterWrap: document.getElementById("tasksDepartmentFilterWrap"),
  departmentFilter: document.getElementById("tasksDepartmentFilter"),
  list: document.getElementById("tasksList"),
  empty: document.getElementById("tasksEmptyState"),
};

let currentUserId = "";
let departments = [];
let editableDepartments = [];
let selectedDepartmentKey = "";
let members = [];
let shiftRows = [];
let tasks = [];
let assignmentMode = "selected";
let taskScope = "mine";
let isTaskLoading = false;
let isFormLoading = false;
let formLoadSequence = 0;

function setStatus(text, tone = "neutral") {
  if (!elements.status) return;

  elements.status.textContent = text;
  elements.status.className = "inline-flex items-center rounded-full px-4 py-1.5 ring-1";

  if (tone === "ok") {
    elements.status.classList.add("bg-emerald-500/10", "text-emerald-200", "ring-emerald-400/20");
  } else if (tone === "error") {
    elements.status.classList.add("bg-rose-500/10", "text-rose-200", "ring-rose-400/20");
  } else if (tone === "busy") {
    elements.status.classList.add("bg-sky-500/10", "text-sky-200", "ring-sky-400/20");
  } else {
    elements.status.classList.add("bg-white/5", "text-slate-300", "ring-white/10");
  }
}

function setError(message) {
  const text = String(message ?? "").trim();
  if (!elements.error) return;

  elements.error.textContent = text;
  elements.error.classList.toggle("hidden", !text);
}

function mapError(error) {
  const message = String(error?.message || error || "");

  if (message.includes("NO_SESSION")) return "Сессия истекла. Войдите заново.";
  if (message.includes("ACCESS_DENIED")) return "У вас нет доступа к задачам этого отдела.";
  if (message.includes("ASSIGNEES_REQUIRED")) return "Выберите хотя бы одного исполнителя.";
  if (message.includes("NO_ASSIGNEES")) return "Для выбранного режима не найдено исполнителей.";
  if (message.includes("RECIPIENT_NOT_IN_DEPARTMENT")) return "Один из выбранных сотрудников больше не состоит в этом отделе.";
  if (message.includes("INVALID_DUE_AT")) return "Срок выполнения должен быть в будущем.";
  if (
    message.includes("create_department_task") ||
    message.includes("list_my_department_tasks") ||
    message.includes("department_tasks") ||
    message.includes("function")
  ) {
    return "Сначала запустите supabase-sql/018_department_tasks.sql в Supabase SQL Editor.";
  }

  return message || "Не удалось выполнить действие.";
}

function toLocalDateValue(date = new Date()) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 10);
}

function toLocalDateTimeValue(date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}

function formatDate(value, options = {}) {
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: options.longMonth ? "long" : "2-digit",
    year: "numeric",
  });
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getMemberName(member) {
  return (
    String(member?.display_name || "").trim() ||
    String(member?.position_name || member?.position || "").trim() ||
    `Сотрудник ${String(member?.user_id || "").slice(0, 8)}`
  );
}

function isRestAfterNight(row) {
  return Math.abs((Number(row?.day_hours) || 0) - 2) < 0.001 &&
    Math.abs((Number(row?.night_hours) || 0) - 5) < 0.001;
}

function isWorkingShift(row) {
  return (Number(row?.day_hours) || 0) + (Number(row?.night_hours) || 0) > 0 && !isRestAfterNight(row);
}

function getWorkingShiftRows() {
  return shiftRows.filter(isWorkingShift);
}

function getSelectedUserIds() {
  return [...elements.members.querySelectorAll('input[type="checkbox"]:checked')]
    .map((input) => String(input.value || "").trim())
    .filter(Boolean);
}

function updateDepartmentOptions() {
  const options = editableDepartments
    .map((department) => `<option value="${department.key}">${department.name}</option>`)
    .join("");

  elements.department.innerHTML = options;
  elements.departmentFilter.innerHTML = options;
  elements.department.value = selectedDepartmentKey;
  elements.departmentFilter.value = selectedDepartmentKey;

  elements.departmentFilterWrap.classList.toggle("hidden", editableDepartments.length < 2);
}

function setDefaultDates() {
  const now = new Date();
  elements.taskDate.value = toLocalDateValue(now);

  const due = new Date(now);
  due.setHours(18, 0, 0, 0);
  if (due.getTime() <= now.getTime()) due.setDate(due.getDate() + 1);
  elements.dueAt.value = toLocalDateTimeValue(due);
}

function updateAssignmentMode() {
  for (const button of elements.assignmentModes) {
    const active = button.dataset.assignmentMode === assignmentMode;
    button.classList.toggle("bg-indigo-500/20", active);
    button.classList.toggle("text-indigo-100", active);
    button.classList.toggle("ring-indigo-400/35", active);
    button.classList.toggle("bg-white/[0.035]", !active);
    button.classList.toggle("text-slate-300", !active);
    button.classList.toggle("ring-white/10", !active);
  }

  elements.selectedBlock.classList.toggle("hidden", assignmentMode !== "selected");
  updateRecipientHint();
}

function updateRecipientHint() {
  const shiftCount = getWorkingShiftRows().length;
  let text = "";

  if (assignmentMode === "selected") {
    const count = getSelectedUserIds().length;
    text = count ? `Получат уведомление: ${count}.` : "Выберите хотя бы одного исполнителя.";
  } else if (assignmentMode === "shift") {
    text = shiftCount
      ? `Получат уведомление все, кто в смене: ${shiftCount}.`
      : "На выбранную дату в смене никого не найдено.";
  } else {
    text = members.length
      ? `Получат уведомление все сотрудники отдела: ${members.length}.`
      : "В отделе пока нет сотрудников.";
  }

  elements.recipientHint.textContent = text;
}

function renderMembers() {
  elements.members.replaceChildren();

  if (!members.length) {
    const empty = document.createElement("div");
    empty.className = "rounded-2xl bg-white/[0.035] p-4 text-sm text-slate-400 ring-1 ring-white/10 sm:col-span-2";
    empty.textContent = "В отделе пока нет сотрудников.";
    elements.members.appendChild(empty);
    updateRecipientHint();
    return;
  }

  for (const member of members) {
    const label = document.createElement("label");
    label.className = "flex min-w-0 cursor-pointer items-start gap-3 rounded-2xl bg-white/[0.035] p-3 ring-1 ring-white/10 transition hover:bg-white/[0.065]";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = member.user_id;
    checkbox.className = "mt-0.5 h-4 w-4 shrink-0 accent-indigo-500";
    checkbox.addEventListener("change", updateRecipientHint);

    const text = document.createElement("span");
    text.className = "min-w-0";

    const name = document.createElement("span");
    name.className = "block truncate text-sm font-semibold text-slate-100";
    name.textContent = getMemberName(member);

    const position = document.createElement("span");
    position.className = "mt-0.5 block truncate text-xs text-slate-400";
    position.textContent = String(member.position_name || member.position || "Сотрудник");

    text.append(name, position);
    label.append(checkbox, text);
    elements.members.appendChild(label);
  }

  updateRecipientHint();
}

function renderShiftPreview() {
  const workingRows = getWorkingShiftRows();
  elements.shiftCount.textContent = String(workingRows.length);
  elements.shiftPreview.replaceChildren();

  if (!workingRows.length) {
    const empty = document.createElement("span");
    empty.className = "text-sm text-slate-400";
    empty.textContent = "Никого не найдено. Проверьте, заполнен ли табель на эту дату.";
    elements.shiftPreview.appendChild(empty);
    updateRecipientHint();
    return;
  }

  for (const row of workingRows) {
    const day = Number(row.day_hours) || 0;
    const night = Number(row.night_hours) || 0;
    const badge = document.createElement("span");
    badge.className = "inline-flex max-w-full items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-100 ring-1 ring-emerald-400/20";

    const name = document.createElement("span");
    name.className = "max-w-52 truncate font-semibold";
    name.textContent = getMemberName(row);

    const hours = document.createElement("span");
    hours.className = "text-emerald-200/75";
    hours.textContent = night > 0 ? `${day}/${night}` : `${day} ч`;

    badge.append(name, hours);
    elements.shiftPreview.appendChild(badge);
  }

  updateRecipientHint();
}

async function loadFormContext() {
  if (!selectedDepartmentKey) return;
  const sequence = ++formLoadSequence;
  isFormLoading = true;
  elements.createSubmit.disabled = true;
  elements.shiftPreview.innerHTML = '<span class="text-sm text-slate-400">Загружаю смену…</span>';
  elements.members.innerHTML = '<div class="rounded-2xl bg-white/[0.035] p-4 text-sm text-slate-400 ring-1 ring-white/10 sm:col-span-2">Загружаю сотрудников…</div>';

  try {
    const [memberRows, overviewRows] = await Promise.all([
      ownerListDepartmentMembers(selectedDepartmentKey),
      listDepartmentShiftOverview({
        departmentKey: selectedDepartmentKey,
        startDate: elements.taskDate.value,
        days: 1,
      }),
    ]);

    if (sequence !== formLoadSequence) return;
    members = memberRows ?? [];
    shiftRows = overviewRows ?? [];
    renderMembers();
    renderShiftPreview();
  } catch (error) {
    if (sequence !== formLoadSequence) return;
    setError(mapError(error));
    members = [];
    shiftRows = [];
    renderMembers();
    renderShiftPreview();
  } finally {
    if (sequence === formLoadSequence) {
      isFormLoading = false;
      elements.createSubmit.disabled = false;
    }
  }
}

function updateTaskScope() {
  for (const button of elements.scopes) {
    const active = button.dataset.taskScope === taskScope;
    button.classList.toggle("bg-indigo-500/20", active);
    button.classList.toggle("text-indigo-100", active);
    button.classList.toggle("text-slate-400", !active);
  }

  const department = editableDepartments.find((item) => item.key === selectedDepartmentKey);
  if (taskScope === "department") {
    elements.listTitle.textContent = department?.name || "Задачи отдела";
    elements.listSubtitle.textContent = "Все задачи, созданные для сотрудников выбранного отдела.";
  } else {
    elements.listTitle.textContent = "Назначено мне";
    elements.listSubtitle.textContent = "Задачи, где вы указаны исполнителем.";
  }
}

function createTextElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function renderTasks() {
  elements.list.replaceChildren();
  elements.empty.classList.toggle("hidden", tasks.length > 0);

  for (const task of tasks) {
    const card = document.createElement("article");
    card.className = "task-card glass-card rounded-3xl p-5 md:p-6";
    card.dataset.taskId = String(task.id);

    const head = document.createElement("div");
    head.className = "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between";

    const meta = document.createElement("div");
    meta.className = "flex min-w-0 flex-wrap items-center gap-2";
    meta.append(
      createTextElement("span", "rounded-full bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-200 ring-1 ring-sky-400/20", task.department_name || task.department_key || "Отдел"),
      createTextElement("span", "rounded-full bg-white/5 px-3 py-1 text-xs text-slate-300 ring-1 ring-white/10", `На ${formatDate(task.task_date)}`)
    );

    head.appendChild(meta);

    if (task.can_manage) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "task-remove-button shrink-0 self-start rounded-xl bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-200 ring-1 ring-rose-400/20 transition hover:bg-rose-500/20";
      remove.textContent = "Удалить";
      remove.addEventListener("click", () => void handleDeleteTask(task));
      head.appendChild(remove);
    }

    const body = createTextElement("p", "task-card-text mt-5 whitespace-pre-wrap break-words text-base leading-7 text-slate-100", task.text || "—");

    const details = document.createElement("div");
    details.className = "task-card-details mt-5 grid gap-3 border-t border-white/10 pt-4 text-sm sm:grid-cols-2";

    const dueBlock = document.createElement("div");
    dueBlock.append(
      createTextElement("div", "text-xs text-slate-500", "Выполнить до"),
      createTextElement("div", "mt-1 font-semibold text-slate-200", formatDateTime(task.due_at))
    );

    const authorBlock = document.createElement("div");
    authorBlock.append(
      createTextElement("div", "text-xs text-slate-500", "Поставил задачу"),
      createTextElement("div", "mt-1 font-semibold text-slate-200", task.creator_name || "Руководитель")
    );
    details.append(dueBlock, authorBlock);

    const assignees = Array.isArray(task.assignees) ? task.assignees : [];
    const assigneesWrap = document.createElement("div");
    assigneesWrap.className = "task-assignees mt-4";
    assigneesWrap.appendChild(createTextElement("div", "text-xs text-slate-500", `Исполнители: ${assignees.length}`));

    const assigneeList = document.createElement("div");
    assigneeList.className = "mt-2 flex flex-wrap gap-2";
    const visibleAssignees = assignees.slice(0, 8);
    for (const assignee of visibleAssignees) {
      const isMe = String(assignee.user_id || "") === currentUserId;
      assigneeList.appendChild(createTextElement(
        "span",
        `max-w-full truncate rounded-full px-3 py-1 text-xs ring-1 ${isMe ? "bg-indigo-500/15 text-indigo-100 ring-indigo-400/30" : "bg-white/5 text-slate-300 ring-white/10"}`,
        isMe ? `${assignee.display_name || "Вы"} · Вы` : assignee.display_name || "Сотрудник"
      ));
    }
    if (assignees.length > visibleAssignees.length) {
      assigneeList.appendChild(createTextElement("span", "rounded-full bg-white/5 px-3 py-1 text-xs text-slate-400 ring-1 ring-white/10", `+${assignees.length - visibleAssignees.length}`));
    }
    assigneesWrap.appendChild(assigneeList);

    card.append(head, body, details, assigneesWrap);
    elements.list.appendChild(card);
  }

  const requestedTaskId = new URL(window.location.href).searchParams.get("task");
  if (requestedTaskId) {
    const requested = elements.list.querySelector(`[data-task-id="${CSS.escape(requestedTaskId)}"]`);
    if (requested) {
      requested.classList.add("ring-2", "ring-indigo-400/60");
      window.setTimeout(() => requested.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
    }
  }
}

async function loadTasks() {
  if (isTaskLoading) return;
  isTaskLoading = true;
  elements.refresh.disabled = true;
  setError("");
  setStatus("Загружаю задачи…", "busy");

  try {
    tasks = await listMyDepartmentTasks({
      departmentKey: taskScope === "department" ? selectedDepartmentKey : null,
      limit: 150,
    });
    renderTasks();
    setStatus(tasks.length ? `Задач: ${tasks.length}` : "Задач пока нет", "ok");
    elements.updated.textContent = `Обновлено: ${new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
  } catch (error) {
    tasks = [];
    renderTasks();
    const message = mapError(error);
    setError(message);
    setStatus("Ошибка загрузки", "error");
  } finally {
    isTaskLoading = false;
    elements.refresh.disabled = false;
  }
}

async function handleCreateTask(event) {
  event.preventDefault();
  if (isFormLoading) return;

  const selectedIds = assignmentMode === "selected" ? getSelectedUserIds() : [];
  if (assignmentMode === "selected" && !selectedIds.length) {
    setError("Выберите хотя бы одного исполнителя.");
    return;
  }

  const due = new Date(elements.dueAt.value);
  if (Number.isNaN(due.getTime())) {
    setError("Укажите корректный срок выполнения.");
    return;
  }

  elements.createSubmit.disabled = true;
  setError("");
  setStatus("Создаю задачу…", "busy");

  try {
    const result = await createDepartmentTask({
      departmentKey: selectedDepartmentKey,
      taskDate: elements.taskDate.value,
      dueAt: due.toISOString(),
      text: elements.taskText.value,
      assignmentMode,
      userIds: selectedIds,
    });

    let pushSent = true;
    try {
      await sendPushNotifications({
        departmentKey: selectedDepartmentKey,
        type: "department_task_assigned",
      });
    } catch (pushError) {
      pushSent = false;
      console.warn("Task created, but push delivery failed:", pushError);
    }

    elements.taskText.value = "";
    elements.members.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.checked = false;
    });
    updateRecipientHint();
    elements.createPanel.classList.add("hidden");

    taskScope = "department";
    updateTaskScope();

    setStatus(
      pushSent
        ? `Задача создана. Исполнителей: ${Number(result?.assignee_count) || 0}`
        : "Задача создана, но push не удалось отправить",
      pushSent ? "ok" : "neutral"
    );
    await loadTasks();
  } catch (error) {
    setError(mapError(error));
    setStatus("Не удалось создать задачу", "error");
  } finally {
    elements.createSubmit.disabled = false;
  }
}

async function handleDeleteTask(task) {
  const confirmed = await confirmDialog({
    title: "Удалить задачу?",
    message: "Она исчезнет у всех назначенных сотрудников.",
    note: String(task?.text || "").slice(0, 160),
    confirmText: "Удалить",
    cancelText: "Оставить",
    tone: "danger",
  });
  if (!confirmed) return;

  try {
    setStatus("Удаляю задачу…", "busy");
    await deleteDepartmentTask(task.id);
    await loadTasks();
  } catch (error) {
    setError(mapError(error));
    setStatus("Не удалось удалить", "error");
  }
}

function bindEvents() {
  elements.openCreate?.addEventListener("click", () => {
    elements.createPanel.classList.toggle("hidden");
    if (!elements.createPanel.classList.contains("hidden")) {
      void loadFormContext();
      window.setTimeout(() => elements.createPanel.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
  });

  elements.closeCreate?.addEventListener("click", () => elements.createPanel.classList.add("hidden"));
  elements.refresh?.addEventListener("click", () => void loadTasks());
  elements.createForm?.addEventListener("submit", handleCreateTask);

  for (const button of elements.pickerButtons) {
    button.addEventListener("click", () => {
      const input = document.getElementById(button.dataset.openPicker || "");
      if (!input) return;

      input.focus({ preventScroll: true });
      if (typeof input.showPicker === "function") input.showPicker();
      else input.click();
    });
  }

  for (const button of elements.assignmentModes) {
    button.addEventListener("click", () => {
      assignmentMode = button.dataset.assignmentMode || "selected";
      updateAssignmentMode();
    });
  }

  for (const button of elements.scopes) {
    button.addEventListener("click", () => {
      taskScope = button.dataset.taskScope || "mine";
      updateTaskScope();
      void loadTasks();
    });
  }

  elements.department?.addEventListener("change", () => {
    selectedDepartmentKey = elements.department.value;
    elements.departmentFilter.value = selectedDepartmentKey;
    updateTaskScope();
    void loadFormContext();
    if (taskScope === "department") void loadTasks();
  });

  elements.departmentFilter?.addEventListener("change", () => {
    selectedDepartmentKey = elements.departmentFilter.value;
    elements.department.value = selectedDepartmentKey;
    updateTaskScope();
    void loadFormContext();
    if (taskScope === "department") void loadTasks();
  });

  elements.taskDate?.addEventListener("change", () => {
    if (elements.taskDate.value) void loadFormContext();
  });

  elements.selectShift?.addEventListener("click", () => {
    const workingUserIds = new Set(getWorkingShiftRows().map((row) => String(row.user_id)));
    elements.members.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.checked = workingUserIds.has(String(input.value));
    });
    updateRecipientHint();
  });
}

async function initialize() {
  let session;
  try {
    session = await requireSession();
  } catch {
    location.href = "login.html?next=tasks.html";
    return;
  }

  currentUserId = String(session?.user?.id || "");
  startPresenceHeartbeat("Мои задачи");
  bindEvents();
  setDefaultDates();
  updateAssignmentMode();
  updateTaskScope();
  setStatus("Загружаю…", "busy");

  try {
    const [profile, allDepartments, managedDepartment, ownDepartmentKey] = await Promise.all([
      getMyProfile(),
      listAllDepartments(),
      getMyManagedDepartment(),
      getMyDepartmentKey(),
    ]);

    departments = allDepartments ?? [];
    const isOwner = profile?.role === "owner";

    if (isOwner) {
      editableDepartments = departments;
    } else if (managedDepartment?.key) {
      editableDepartments = departments.filter((department) => department.key === managedDepartment.key);
      if (!editableDepartments.length) editableDepartments = [managedDepartment];
    }

    if (editableDepartments.length) {
      selectedDepartmentKey = editableDepartments.some((department) => department.key === ownDepartmentKey)
        ? ownDepartmentKey
        : editableDepartments[0].key;
      elements.openCreate.classList.remove("hidden");
      elements.scopeControl.classList.remove("hidden");
      updateDepartmentOptions();
      await loadFormContext();
    }

    await loadTasks();
  } catch (error) {
    setError(mapError(error));
    setStatus("Ошибка загрузки", "error");
  }
}

void initialize();
