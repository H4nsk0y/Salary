import { requireSession } from "./auth.js";
import { getMyProfile, listAllDepartments, ownerListClientErrors } from "./db.js";
import { startPresenceHeartbeat } from "./presence.js";
import { getPushNotificationState } from "./pushNotifications.js";
import { classifyClientError } from "./clientErrorInsights.js";

document.body.classList.add("is-loaded");

const refreshButton = document.getElementById("refreshStatusBtn");
const checksContainer = document.getElementById("statusChecks");
const summaryText = document.getElementById("summaryText");
const okCount = document.getElementById("okCount");
const warnCount = document.getElementById("warnCount");
const errorCount = document.getElementById("errorCount");

function elapsed(startedAt) {
  return `${Math.max(1, Math.round(performance.now() - startedAt))} мс`;
}

function makeCheck(name, status, detail, timing = "") {
  return { name, status, detail, timing };
}

async function checkDatabase() {
  const startedAt = performance.now();
  try {
    const departments = await listAllDepartments();
    return makeCheck("База данных", "ok", `Соединение установлено, доступно отделов: ${departments.length}.`, elapsed(startedAt));
  } catch (error) {
    return makeCheck("База данных", "error", `Нет ответа: ${error?.message || "неизвестная ошибка"}.`, elapsed(startedAt));
  }
}

async function checkServiceWorker() {
  try {
    if (!("serviceWorker" in navigator)) return makeCheck("Обновления и офлайн-кеш", "warn", "Этот браузер не поддерживает Service Worker.");
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return makeCheck("Обновления и офлайн-кеш", "warn", "Service Worker ещё не зарегистрирован на этом устройстве.");
    return makeCheck("Обновления и офлайн-кеш", "ok", navigator.serviceWorker.controller ? "Service Worker активен и управляет страницей." : "Установлен; начнёт управлять страницей после обновления.");
  } catch (error) {
    return makeCheck("Обновления и офлайн-кеш", "warn", error?.message || "Проверка Service Worker не удалась.");
  }
}

async function checkPush() {
  try {
    const state = await getPushNotificationState();
    if (!state.supported) return makeCheck("Push на этом устройстве", "warn", state.reason || "Браузер не поддерживает push-уведомления.");
    if (state.permission === "denied") return makeCheck("Push на этом устройстве", "warn", "Уведомления запрещены в настройках браузера.");
    if (!state.subscribed) return makeCheck("Push на этом устройстве", "warn", "Подписка не включена на этом устройстве.");
    return makeCheck("Push на этом устройстве", "ok", "Разрешение выдано, активная подписка найдена.");
  } catch (error) {
    return makeCheck("Push на этом устройстве", "warn", error?.message || "Не удалось проверить подписку.");
  }
}

async function checkErrors() {
  const startedAt = performance.now();
  try {
    const rows = await ownerListClientErrors(100);
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const recent = rows.filter((row) => new Date(row.created_at).getTime() >= since);
    if (!recent.length) return makeCheck("Серьёзные ошибки", "ok", "За последние 24 часа новых записей нет.", elapsed(startedAt));
    const latest = classifyClientError(recent[0]);
    return makeCheck("Серьёзные ошибки", "warn", `За 24 часа: ${recent.length}. Последняя: ${latest.code} · ${latest.title}.`, elapsed(startedAt));
  } catch (error) {
    return makeCheck("Серьёзные ошибки", "warn", `Журнал недоступен: ${error?.message || "неизвестная ошибка"}.`, elapsed(startedAt));
  }
}

async function checkStorage() {
  try {
    if (!navigator.storage?.estimate) return makeCheck("Локальное хранилище", "warn", "Браузер не сообщает объём локального хранилища.");
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    const percent = quota ? (usage / quota) * 100 : 0;
    return makeCheck("Локальное хранилище", percent > 85 ? "warn" : "ok", `Использовано ${percent.toFixed(1)}% доступного браузеру места.`);
  } catch (error) {
    return makeCheck("Локальное хранилище", "warn", error?.message || "Не удалось проверить хранилище.");
  }
}

function renderChecks(checks) {
  checksContainer.replaceChildren();
  for (const check of checks) {
    const row = document.createElement("article");
    row.className = "status-check";
    const dot = document.createElement("span");
    dot.className = `status-dot ${check.status}`;
    dot.setAttribute("aria-label", check.status === "ok" ? "Исправно" : check.status === "warn" ? "Требует внимания" : "Недоступно");
    const content = document.createElement("div");
    const title = document.createElement("h2");
    title.className = "text-sm font-semibold text-[#f1eee8]";
    title.textContent = check.name;
    const detail = document.createElement("p");
    detail.className = "mt-1 text-sm leading-6 text-[#969ca2]";
    detail.textContent = check.detail;
    content.append(title, detail);
    const timing = document.createElement("span");
    timing.className = "status-check-time text-xs text-[#72787e]";
    timing.textContent = check.timing;
    row.append(dot, content, timing);
    checksContainer.append(row);
  }

  const counts = { ok: 0, warn: 0, error: 0 };
  checks.forEach((check) => { counts[check.status] += 1; });
  okCount.textContent = String(counts.ok);
  warnCount.textContent = String(counts.warn);
  errorCount.textContent = String(counts.error);
  summaryText.textContent = counts.error
    ? "Есть недоступные компоненты. Проверьте подробности ниже."
    : counts.warn
      ? "Основные компоненты доступны, но есть пункты, требующие внимания."
      : "Все проверенные компоненты работают штатно.";
}

async function runChecks() {
  refreshButton.disabled = true;
  refreshButton.textContent = "Проверяю…";
  const connection = navigator.onLine
    ? makeCheck("Интернет и защищённое соединение", window.isSecureContext ? "ok" : "warn", window.isSecureContext ? "Устройство онлайн, страница открыта по защищённому соединению." : "Устройство онлайн, но защищённый контекст недоступен.")
    : makeCheck("Интернет и защищённое соединение", "error", "Браузер сообщает об отсутствии сети.");
  try {
    const results = await Promise.all([checkDatabase(), checkServiceWorker(), checkPush(), checkErrors(), checkStorage()]);
    renderChecks([connection, ...results]);
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = "Проверить снова";
  }
}

refreshButton.addEventListener("click", () => void runChecks());

(async () => {
  try {
    await requireSession();
    const profile = await getMyProfile();
    if (profile?.role !== "owner") {
      location.href = "profile.html";
      return;
    }
    startPresenceHeartbeat("Owner: состояние системы");
    await runChecks();
  } catch {
    location.href = "login.html?next=owner-status.html";
  }
})();
