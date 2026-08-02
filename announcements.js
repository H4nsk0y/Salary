import { requireSession } from "./auth.js";
import {
  getMyManagedDepartment,
  getMyProfile,
  listAllDepartments,
  sendDepartmentAnnouncement,
  sendPushNotifications,
} from "./db.js";
import { confirmDialog } from "./modal.js";
import { startPresenceHeartbeat } from "./presence.js";

const ALL_USERS_VALUE = "__all__";
const params = new URLSearchParams(location.search);
const requestedDepartmentKey = String(params.get("department") || "").trim();

const elements = {
  form: document.getElementById("announcementForm"),
  audience: document.getElementById("audienceSelect"),
  audienceNote: document.getElementById("audienceNote"),
  title: document.getElementById("titleInput"),
  body: document.getElementById("bodyInput"),
  titleCounter: document.getElementById("titleCounter"),
  bodyCounter: document.getElementById("bodyCounter"),
  previewTitle: document.getElementById("previewTitle"),
  previewBody: document.getElementById("previewBody"),
  previewAudience: document.getElementById("previewAudience"),
  submit: document.getElementById("submitButton"),
  status: document.getElementById("statusText"),
  back: document.getElementById("backLink"),
};

let isOwner = false;
let availableDepartments = [];
let isSending = false;

function setStatus(message = "", tone = "") {
  elements.status.textContent = message;
  elements.status.className = `status${tone ? ` ${tone}` : ""}`;
}

function selectedDepartment() {
  const key = String(elements.audience.value || "");
  return availableDepartments.find((department) => department.key === key) ?? null;
}

function updatePreview() {
  const title = elements.title.value.trim();
  const body = elements.body.value.trim();
  const department = selectedDepartment();
  const globalAudience = elements.audience.value === ALL_USERS_VALUE;

  elements.titleCounter.textContent = `${elements.title.value.length} / 80`;
  elements.bodyCounter.textContent = `${elements.body.value.length} / 1000`;
  elements.previewTitle.textContent = title || "Объявление отдела";
  elements.previewBody.textContent = body || "Здесь появится текст вашего объявления.";
  elements.previewAudience.textContent = globalAudience
    ? "Все пользователи"
    : department?.name || "Отдел";

  elements.audienceNote.textContent = globalAudience
    ? "Объявление получат все зарегистрированные пользователи."
    : `Объявление получат сотрудники отдела «${department?.name || "—"}».`;

  if (globalAudience) {
    elements.back.href = "owner.html";
    elements.back.textContent = "Вернуться к отделам";
  } else if (department?.key) {
    elements.back.href = `admin.html?department=${encodeURIComponent(department.key)}`;
    elements.back.textContent = "Вернуться в табель";
  }
}

function renderAudienceOptions(selectedKey = "") {
  elements.audience.replaceChildren();

  if (isOwner) {
    elements.audience.add(new Option("Все пользователи", ALL_USERS_VALUE));
  }

  for (const department of availableDepartments) {
    elements.audience.add(new Option(department.name, department.key));
  }

  const requestedIsAvailable = availableDepartments.some(
    (department) => department.key === selectedKey
  );

  if (requestedIsAvailable) {
    elements.audience.value = selectedKey;
  } else if (isOwner) {
    elements.audience.value = ALL_USERS_VALUE;
  } else if (availableDepartments[0]) {
    elements.audience.value = availableDepartments[0].key;
  }

  elements.audience.disabled = !isOwner && availableDepartments.length <= 1;
  updatePreview();
}

function mapError(error) {
  const message = String(error?.message || error || "");

  if (message.includes("NO_SESSION")) return "Сессия истекла. Войдите заново.";
  if (message.includes("ACCESS_DENIED")) return "У вас нет права отправлять объявления этим получателям.";
  if (message.includes("DEPARTMENT_NOT_FOUND")) return "Выбранный отдел не найден.";
  if (message.includes("INVALID_TITLE")) return "Заголовок должен содержать от 2 до 80 символов.";
  if (message.includes("INVALID_BODY")) return "Текст должен содержать от 1 до 1000 символов.";
  if (
    message.includes("send_department_announcement") ||
    message.includes("Could not find the function") ||
    message.includes("schema cache")
  ) {
    return "Сначала запустите supabase-sql/025_department_announcements.sql в Supabase SQL Editor.";
  }

  return message || "Не удалось отправить объявление.";
}

async function submitAnnouncement(event) {
  event.preventDefault();
  if (isSending) return;

  const title = elements.title.value.trim();
  const body = elements.body.value.trim();
  const isGlobal = elements.audience.value === ALL_USERS_VALUE;
  const department = selectedDepartment();

  if (title.length < 2) {
    setStatus("Добавьте понятный заголовок.", "error");
    elements.title.focus();
    return;
  }

  if (!body) {
    setStatus("Напишите текст объявления.", "error");
    elements.body.focus();
    return;
  }

  const audienceLabel = isGlobal ? "всем пользователям" : `отделу «${department?.name || "—"}»`;
  const confirmed = await confirmDialog({
    title: "Отправить объявление?",
    message: `Сообщение будет отправлено ${audienceLabel}.`,
    confirmText: "Отправить",
    cancelText: "Отмена",
  });

  if (!confirmed) return;

  isSending = true;
  elements.submit.disabled = true;
  setStatus("Отправляю…");

  try {
    const result = await sendDepartmentAnnouncement({
      departmentKey: isGlobal ? null : department?.key,
      title,
      body,
    });

    const recipientCount = Number(result?.recipient_count) || 0;

    if (recipientCount > 0) {
      try {
        await sendPushNotifications({
          departmentKey: isGlobal ? null : department?.key,
          type: "department_announcement",
          allUsers: isGlobal,
        });
        setStatus(`Отправлено получателям: ${recipientCount}.`, "ok");
      } catch {
        setStatus(`В колокольчик отправлено: ${recipientCount}. Push временно не доставлен.`, "error");
      }
    } else {
      setStatus("Получателей для этого объявления не найдено.", "error");
    }
  } catch (error) {
    setStatus(mapError(error), "error");
  } finally {
    isSending = false;
    elements.submit.disabled = false;
  }
}

async function initialize() {
  try {
    await requireSession();
  } catch {
    const next = `announcements.html${location.search}`;
    location.href = `login.html?next=${encodeURIComponent(next)}`;
    return;
  }

  startPresenceHeartbeat("Объявления");

  elements.title.addEventListener("input", updatePreview);
  elements.body.addEventListener("input", updatePreview);
  elements.audience.addEventListener("change", updatePreview);
  elements.form.addEventListener("submit", submitAnnouncement);
  updatePreview();

  try {
    const [profile, managedDepartment] = await Promise.all([
      getMyProfile(),
      getMyManagedDepartment(),
    ]);

    isOwner = profile?.role === "owner";

    if (isOwner) {
      availableDepartments = await listAllDepartments();
    } else if (managedDepartment?.key) {
      availableDepartments = [managedDepartment];
    }

    if (!availableDepartments.length && !isOwner) {
      throw new Error("ACCESS_DENIED");
    }

    renderAudienceOptions(requestedDepartmentKey || managedDepartment?.key || "");
  } catch (error) {
    elements.form.querySelectorAll("input, textarea, select, button").forEach((control) => {
      control.disabled = true;
    });
    setStatus(mapError(error), "error");
  }
}

void initialize();
