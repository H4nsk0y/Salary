import { requireSession } from "./auth.js";
import {
  finishMyShiftChecklist,
  getMyDepartmentKey,
  getMyShiftChecklistState,
  sendPushNotifications,
  startMyShiftChecklist,
  updateMyShiftChecklist,
} from "./db.js";
import { startPresenceHeartbeat } from "./presence.js";
import { setUiStatus } from "./uiStatus.js";
import {
  checklistProgress,
  createChecklistItem,
  DEPARTMENT_NAMES,
  getDepartmentChecklistTemplates,
  normalizeChecklistItems,
} from "./shiftChecklist.js";

const loadingNotice = document.getElementById("loadingNotice");
const errorNotice = document.getElementById("errorNotice");
const departmentChip = document.getElementById("departmentChip");
const latestResult = document.getElementById("latestResult");
const latestScore = document.getElementById("latestScore");
const latestMeta = document.getElementById("latestMeta");
const setupView = document.getElementById("setupView");
const templateGrid = document.getElementById("templateGrid");
const emptyTemplates = document.getElementById("emptyTemplates");
const setupCustomForm = document.getElementById("setupCustomForm");
const setupCustomInput = document.getElementById("setupCustomInput");
const selectedList = document.getElementById("selectedList");
const selectionCount = document.getElementById("selectionCount");
const setupReminders = document.getElementById("setupReminders");
const startShiftBtn = document.getElementById("startShiftBtn");
const activeView = document.getElementById("activeView");
const activeMeta = document.getElementById("activeMeta");
const progressValue = document.getElementById("progressValue");
const progressCaption = document.getElementById("progressCaption");
const progressBar = document.getElementById("progressBar");
const activeList = document.getElementById("activeList");
const activeCustomForm = document.getElementById("activeCustomForm");
const activeCustomInput = document.getElementById("activeCustomInput");
const activeTemplates = document.getElementById("activeTemplates");
const activeReminders = document.getElementById("activeReminders");
const nextReminderText = document.getElementById("nextReminderText");
const saveState = document.getElementById("saveState");
const finishShiftBtn = document.getElementById("finishShiftBtn");
const summaryOverlay = document.getElementById("summaryOverlay");
const summaryPercent = document.getElementById("summaryPercent");
const summaryList = document.getElementById("summaryList");
const summaryCancelBtn = document.getElementById("summaryCancelBtn");
const summaryConfirmBtn = document.getElementById("summaryConfirmBtn");

let departmentKey = null;
let templates = [];
let setupItems = [];
let activeChecklist = null;
let saveTimer = null;
let saveChain = Promise.resolve();

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function setError(message = "") {
  if (!errorNotice) return;
  errorNotice.textContent = message;
  errorNotice.classList.toggle("hidden", !message);
}

function friendlyError(error) {
  const message = String(error?.message ?? error ?? "");
  if (/get_my_shift_checklist_state|start_my_shift_checklist|PGRST202/i.test(message)) {
    return "Чек-лист еще не подключен к базе данных. Выполните SQL-скрипт 032_shift_checklists.sql.";
  }
  if (/ACTIVE_CHECKLIST_EXISTS/i.test(message)) return "У вас уже есть активная смена. Обновите страницу.";
  if (/CHECKLIST_NOT_FOUND/i.test(message)) return "Активная смена уже завершена или удалена.";
  if (/INVALID_CHECKLIST_ITEMS/i.test(message)) return "Проверьте пункты списка: допускается до 40 пунктов по 160 символов.";
  return message || "Не удалось выполнить действие.";
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function containsText(items, text) {
  const token = String(text).trim().toLocaleLowerCase("ru-RU");
  return items.some((item) => item.text.toLocaleLowerCase("ru-RU") === token);
}

function addItem(items, text, source = "custom") {
  if (containsText(items, text) || items.length >= 40) return false;
  const item = createChecklistItem(text, source);
  if (!item) return false;
  items.push(item);
  return true;
}

function renderLatest(completed) {
  if (!completed) {
    latestResult?.classList.add("hidden");
    return;
  }

  const progress = checklistProgress(completed.items);
  if (latestScore) latestScore.textContent = `${progress.percent}%`;
  if (latestMeta) {
    latestMeta.textContent = `${progress.completed} из ${progress.total} · ${formatDateTime(completed.completed_at)}`;
  }
  latestResult?.classList.remove("hidden");
}

function renderSetup() {
  activeView?.classList.add("hidden");
  setupView?.classList.remove("hidden");
  renderSetupTemplates();
  renderSelectedItems();
}

function renderSetupTemplates() {
  if (!templateGrid) return;
  templateGrid.innerHTML = "";
  emptyTemplates?.classList.toggle("hidden", templates.length > 0);

  templates.forEach((text) => {
    const selected = containsText(setupItems, text);
    const button = element("button", `template-card${selected ? " selected" : ""}`, text);
    button.type = "button";
    button.setAttribute("aria-pressed", String(selected));
    button.addEventListener("click", () => {
      const index = setupItems.findIndex(
        (item) => item.text.toLocaleLowerCase("ru-RU") === text.toLocaleLowerCase("ru-RU")
      );
      if (index >= 0) setupItems.splice(index, 1);
      else addItem(setupItems, text, "standard");
      renderSetupTemplates();
      renderSelectedItems();
    });
    templateGrid.append(button);
  });
}

function renderSelectedItems() {
  if (!selectedList) return;
  selectedList.innerHTML = "";

  setupItems.forEach((item) => {
    const row = element("div", "selected-row");
    const text = element("span", "", item.text);
    const remove = element("button", "remove-button", "×");
    remove.type = "button";
    remove.setAttribute("aria-label", `Убрать: ${item.text}`);
    remove.addEventListener("click", () => {
      setupItems = setupItems.filter((candidate) => candidate.id !== item.id);
      renderSetupTemplates();
      renderSelectedItems();
    });
    row.append(text, remove);
    selectedList.append(row);
  });

  if (selectionCount) {
    selectionCount.textContent = setupItems.length
      ? `Пунктов в смене: ${setupItems.length}`
      : "Пока ничего";
  }
  if (startShiftBtn) startShiftBtn.disabled = setupItems.length === 0;
}

function renderActive() {
  if (!activeChecklist) return;
  setupView?.classList.add("hidden");
  activeView?.classList.remove("hidden");

  activeChecklist.items = normalizeChecklistItems(activeChecklist.items);
  const progress = checklistProgress(activeChecklist.items);
  if (activeMeta) activeMeta.textContent = `Начата ${formatDateTime(activeChecklist.started_at)}`;
  if (progressValue) progressValue.textContent = `${progress.percent}%`;
  if (progressCaption) progressCaption.textContent = `${progress.completed} из ${progress.total}`;
  if (progressBar) progressBar.style.width = `${progress.percent}%`;
  if (activeReminders) activeReminders.checked = activeChecklist.reminders_enabled === true;
  if (nextReminderText) {
    nextReminderText.textContent = activeChecklist.reminders_enabled
      ? `Следующая проверка после ${formatDateTime(activeChecklist.next_reminder_at)}`
      : "Напоминания отключены";
  }

  renderActiveItems();
  renderActiveTemplates();
}

function renderActiveItems() {
  if (!activeList || !activeChecklist) return;
  activeList.innerHTML = "";

  activeChecklist.items.forEach((item) => {
    const row = element("div", `check-row${item.done ? " done" : ""}`);
    const toggle = element("button", "check-toggle", "✓");
    toggle.type = "button";
    toggle.setAttribute("aria-label", item.done ? `Снять отметку: ${item.text}` : `Выполнено: ${item.text}`);
    toggle.addEventListener("click", () => {
      item.done = !item.done;
      renderActive();
      scheduleSave();
    });

    const text = element("div", "check-text", item.text);
    text.addEventListener("click", () => toggle.click());

    const remove = element("button", "remove-button", "×");
    remove.type = "button";
    remove.setAttribute("aria-label", `Удалить: ${item.text}`);
    remove.addEventListener("click", () => {
      if (activeChecklist.items.length <= 1) {
        setSaveState("В чек-листе должен остаться хотя бы один пункт", "error");
        return;
      }
      activeChecklist.items = activeChecklist.items.filter((candidate) => candidate.id !== item.id);
      renderActive();
      scheduleSave();
    });
    row.append(toggle, text, remove);
    activeList.append(row);
  });
}

function renderActiveTemplates() {
  if (!activeTemplates || !activeChecklist) return;
  activeTemplates.innerHTML = "";
  const missing = templates.filter((text) => !containsText(activeChecklist.items, text));

  if (!missing.length) {
    activeTemplates.append(element("div", "section-copy", "Все стандартные пункты уже в списке."));
    return;
  }

  missing.forEach((text) => {
    const button = element("button", "active-template", `+ ${text}`);
    button.type = "button";
    button.addEventListener("click", () => {
      if (!addItem(activeChecklist.items, text, "standard")) return;
      renderActive();
      scheduleSave();
    });
    activeTemplates.append(button);
  });
}

function setSaveState(message, type = "") {
  if (!saveState) return;
  const tone = type === "ok"
    ? "ok"
    : type === "error"
      ? "err"
      : message.includes("Сохраняю")
        ? "busy"
        : "neutral";
  setUiStatus(saveState, message, tone, {
    baseClassName: `save-state${type ? ` ${type}` : ""}`,
  });
}

function queueSave() {
  if (!activeChecklist) return Promise.resolve();
  const checklistId = activeChecklist.id;
  const snapshot = {
    items: normalizeChecklistItems(activeChecklist.items),
    remindersEnabled: activeChecklist.reminders_enabled === true,
  };

  setSaveState("Сохраняю…");
  const operation = saveChain.catch(() => undefined).then(async () => {
    const saved = await updateMyShiftChecklist(checklistId, snapshot);
    if (activeChecklist?.id === checklistId && saved?.next_reminder_at) {
      activeChecklist.next_reminder_at = saved.next_reminder_at;
      if (nextReminderText && activeChecklist.reminders_enabled) {
        nextReminderText.textContent = `Следующая проверка после ${formatDateTime(saved.next_reminder_at)}`;
      }
    }
    setSaveState("Сохранено", "ok");
  });
  operation.catch((error) => {
    setSaveState(friendlyError(error), "error");
  });
  saveChain = operation;
  return operation;
}

function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void queueSave().catch(() => undefined), 450);
}

function flushSave() {
  window.clearTimeout(saveTimer);
  return queueSave();
}

function openSummary() {
  if (!activeChecklist) return;
  const progress = checklistProgress(activeChecklist.items);
  if (summaryPercent) summaryPercent.textContent = `${progress.percent}%`;
  if (summaryList) {
    summaryList.innerHTML = "";
    activeChecklist.items.forEach((item) => {
      const row = element("div", `summary-item${item.done ? " done" : ""}`);
      row.append(element("span", "", item.done ? "✓" : "○"), element("span", "", item.text));
      summaryList.append(row);
    });
  }
  summaryOverlay?.classList.remove("hidden");
  summaryCancelBtn?.focus();
}

function closeSummary() {
  summaryOverlay?.classList.add("hidden");
}

function showSuccess() {
  const overlay = element("div", "success-flash");
  const card = element("div", "success-card");
  card.append(
    element("div", "success-mark", "✓"),
    element("h2", "", "Идеальная смена"),
    element("p", "", "Все пункты выполнены. Можно спокойно идти отдыхать.")
  );
  overlay.append(card);
  document.body.append(overlay);
  window.setTimeout(() => overlay.remove(), 3000);
}

setupCustomForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!addItem(setupItems, setupCustomInput?.value, "custom")) return;
  setupCustomInput.value = "";
  renderSelectedItems();
});

activeCustomForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!activeChecklist || !addItem(activeChecklist.items, activeCustomInput?.value, "custom")) return;
  activeCustomInput.value = "";
  renderActive();
  scheduleSave();
});

startShiftBtn?.addEventListener("click", async () => {
  if (!setupItems.length) return;
  startShiftBtn.disabled = true;
  setError("");
  try {
    activeChecklist = await startMyShiftChecklist({
      items: normalizeChecklistItems(setupItems),
      remindersEnabled: setupReminders?.checked === true,
    });
    setupItems = [];
    renderActive();
  } catch (error) {
    setError(friendlyError(error));
    startShiftBtn.disabled = false;
  }
});

activeReminders?.addEventListener("change", () => {
  if (!activeChecklist) return;
  activeChecklist.reminders_enabled = activeReminders.checked;
  renderActive();
  scheduleSave();
});

finishShiftBtn?.addEventListener("click", openSummary);
summaryCancelBtn?.addEventListener("click", closeSummary);
summaryOverlay?.addEventListener("click", (event) => {
  if (event.target === summaryOverlay) closeSummary();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !summaryOverlay?.classList.contains("hidden")) closeSummary();
});

summaryConfirmBtn?.addEventListener("click", async () => {
  if (!activeChecklist) return;
  summaryConfirmBtn.disabled = true;
  const progress = checklistProgress(activeChecklist.items);
  try {
    await flushSave();
    const completed = await finishMyShiftChecklist(activeChecklist.id);
    const handoverRecipients = Number(completed?.handover_recipients) || 0;
    if (handoverRecipients > 0 && completed?.department_key) {
      try {
        await sendPushNotifications({
          departmentKey: completed.department_key,
          type: "shift_handover_ready",
        });
      } catch {
        // The in-site notification is already saved; push can be retried separately.
      }
    }
    closeSummary();
    activeChecklist = null;
    renderLatest(completed);
    setupItems = [];
    renderSetup();
    if (progress.percent === 100) showSuccess();
  } catch (error) {
    setError(friendlyError(error));
  } finally {
    summaryConfirmBtn.disabled = false;
  }
});

async function init() {
  try {
    await requireSession();
  } catch {
    location.href = "login.html?next=checklist.html";
    return;
  }

  startPresenceHeartbeat("Чек-лист смены");

  try {
    departmentKey = await getMyDepartmentKey();
    templates = getDepartmentChecklistTemplates(departmentKey);
    if (departmentChip) departmentChip.textContent = DEPARTMENT_NAMES[departmentKey] || "Личный список";

    const state = await getMyShiftChecklistState();
    activeChecklist = state?.active ?? null;
    renderLatest(state?.latest_completed ?? null);
    loadingNotice?.classList.add("hidden");
    setError("");

    if (activeChecklist) renderActive();
    else renderSetup();
  } catch (error) {
    loadingNotice?.classList.add("hidden");
    setError(friendlyError(error));
  }
}

void init();
