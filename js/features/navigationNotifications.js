import {
  deleteAllMyNotifications,
  deleteMyNotification,
  listMyNotifications,
  markMyNotificationsRead,
} from "../db.js";
import { alertDialog, confirmDialog } from "../modal.js";
import { normalizeInternalNextUrl } from "../profileCompletion.js";

const NOTIFICATION_READ_STORAGE_KEY = "alvisa.notificationReadIds.v1";
const NOTIFICATION_POLL_INTERVAL_MS = 45000;
function createBellIcon() {
  const span = document.createElement("span");
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10.27 21a2 2 0 0 0 3.46 0"></path>
      <path d="M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.86 18 12.28 18 8a6 6 0 0 0-12 0c0 4.28-1.41 5.86-2.74 7.33Z"></path>
    </svg>
  `;
  return span;
}

function formatNotificationTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getLocalNotificationReadIds() {
  try {
    const raw = localStorage.getItem(NOTIFICATION_READ_STORAGE_KEY);
    const parsed = JSON.parse(raw || "[]");
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function rememberLocalNotificationReadIds(ids) {
  if (!ids?.length) return;

  try {
    const readIds = getLocalNotificationReadIds();
    for (const id of ids) readIds.add(String(id));

    const compact = Array.from(readIds).slice(-300);
    localStorage.setItem(NOTIFICATION_READ_STORAGE_KEY, JSON.stringify(compact));
  } catch {
    // Browser storage can be disabled; server state remains the source of truth.
  }
}

function applyLocalNotificationReadState(items) {
  const readIds = getLocalNotificationReadIds();
  if (!readIds.size) return items;

  return items.map((item) => {
    if (item?.read_at || !readIds.has(String(item?.id))) return item;
    return { ...item, read_at: "local" };
  });
}

export function createNotificationsWidget() {
  const root = document.createElement("div");
  root.className = "app-notifications";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "app-notification-button";
  button.setAttribute("aria-label", "Уведомления");
  button.setAttribute("aria-expanded", "false");
  button.appendChild(createBellIcon());

  const badge = document.createElement("span");
  badge.className = "app-notification-badge";
  badge.textContent = "0";
  button.appendChild(badge);

  const panel = document.createElement("div");
  panel.className = "app-notification-panel";

  const head = document.createElement("div");
  head.className = "app-notification-panel-head";

  const title = document.createElement("div");
  title.className = "app-notification-panel-title";
  title.textContent = "Уведомления";

  const headActions = document.createElement("div");
  headActions.className = "app-notification-panel-actions";

  const clearAll = document.createElement("button");
  clearAll.type = "button";
  clearAll.className = "app-notification-clear";
  clearAll.textContent = "Очистить все";
  clearAll.hidden = true;

  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "app-notification-refresh";
  refresh.textContent = "Обновить";

  const list = document.createElement("div");
  list.className = "app-notification-list";
  list.innerHTML = `<div class="app-notification-empty">Загружаю…</div>`;

  headActions.append(clearAll, refresh);
  head.append(title, headActions);
  panel.append(head, list);
  root.append(button, panel);

  let notifications = [];
  let loaded = false;
  let loading = false;
  let markAfterLoad = false;
  let markingRead = false;
  let pollTimer = null;

  const updateBadge = () => {
    const count = notifications.filter((item) => !item.read_at).length;
    badge.textContent = count > 9 ? "9+" : String(count);
    badge.classList.toggle("is-visible", count > 0);
    clearAll.hidden = notifications.length === 0;
  };

  const getUnreadNotificationIds = () =>
    notifications
      .filter((item) => !item.read_at)
      .map((item) => Number(item.id))
      .filter((id) => Number.isFinite(id));

  const markVisibleNotificationsRead = async () => {
    if (markingRead) return;

    const ids = getUnreadNotificationIds();
    if (!ids.length) return;

    markingRead = true;
    const readAt = new Date().toISOString();
    rememberLocalNotificationReadIds(ids);
    notifications = notifications.map((item) =>
      ids.includes(Number(item.id)) ? { ...item, read_at: item.read_at || readAt } : item
    );
    updateBadge();

    try {
      await markMyNotificationsRead(ids);
    } catch {
      // The local mark keeps the badge calm until the DB migration is applied.
    } finally {
      markingRead = false;
    }
  };

  const renderList = () => {
    list.innerHTML = "";

    if (!notifications.length) {
      const empty = document.createElement("div");
      empty.className = "app-notification-empty";
      empty.textContent = "Новых уведомлений нет.";
      list.appendChild(empty);
      updateBadge();
      return;
    }

    for (const item of notifications) {
      const card = document.createElement("div");
      card.className = "app-notification-item";
      card.classList.toggle("is-unread", !item.read_at);

      const row = document.createElement("div");
      row.className = "app-notification-title-row";

      const itemTitle = document.createElement("div");
      itemTitle.className = "app-notification-title";
      itemTitle.textContent = item.title || "Уведомление";

      const del = document.createElement("button");
      del.type = "button";
      del.className = "app-notification-delete";
      del.setAttribute("aria-label", "Удалить уведомление");
      del.textContent = "×";
      del.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const previous = notifications;
        notifications = notifications.filter((n) => n.id !== item.id);
        renderList();

        try {
          await deleteMyNotification(item.id);
        } catch {
          notifications = previous;
          renderList();
        }
      });

      row.append(itemTitle, del);

      const body = document.createElement("div");
      body.className = "app-notification-body";
      body.textContent = item.body || "";

      const meta = document.createElement("div");
      meta.className = "app-notification-meta";

      const time = document.createElement("span");
      time.textContent = formatNotificationTime(item.created_at);

      meta.appendChild(time);

      const href = normalizeInternalNextUrl(item.url, "");
      if (href) {
        const open = document.createElement("a");
        open.href = href;
        open.className = "app-notification-open";
        open.textContent = "Открыть";
        meta.appendChild(open);
      }

      card.append(row, body, meta);
      list.appendChild(card);
    }

    updateBadge();
  };

  const showError = () => {
    list.innerHTML = `<div class="app-notification-error">Не удалось загрузить уведомления. Если функция новая, запусти SQL-файл для уведомлений.</div>`;
    notifications = [];
    updateBadge();
  };

  const load = async ({ silent = false } = {}) => {
    if (loading) return;
    loading = true;

    if (!loaded && !silent) {
      list.innerHTML = `<div class="app-notification-empty">Загружаю…</div>`;
    }

    try {
      notifications = applyLocalNotificationReadState(await listMyNotifications());
      loaded = true;
      renderList();
      if (markAfterLoad && !panel.classList.contains("is-open")) {
        markAfterLoad = false;
        void markVisibleNotificationsRead();
      }
    } catch (error) {
      loaded = true;
      if (String(error?.message || "").includes("NO_SESSION")) {
        root.classList.add("hidden");
        return;
      }
      showError();
    } finally {
      loading = false;
    }
  };

  const setOpen = (nextOpen) => {
    const wasOpen = panel.classList.contains("is-open");
    panel.classList.toggle("is-open", nextOpen);
    button.classList.toggle("is-open", nextOpen);
    button.setAttribute("aria-expanded", String(nextOpen));
    if (nextOpen) void load();
    else if (wasOpen) {
      if (loading) markAfterLoad = true;
      void markVisibleNotificationsRead();
    }
  };

  button.addEventListener("click", () => {
    setOpen(!panel.classList.contains("is-open"));
  });

  refresh.addEventListener("click", () => {
    loaded = false;
    void load();
  });

  clearAll.addEventListener("click", async () => {
    if (!notifications.length || clearAll.disabled) return;

    const confirmed = await confirmDialog({
      title: "Очистить уведомления?",
      message: "Все уведомления будут удалены из списка.",
      note: "Это действие нельзя отменить.",
      confirmText: "Очистить все",
      cancelText: "Оставить",
      tone: "danger",
    });
    if (!confirmed) return;

    clearAll.disabled = true;
    refresh.disabled = true;

    try {
      await deleteAllMyNotifications();
      notifications = [];
      try {
        localStorage.removeItem(NOTIFICATION_READ_STORAGE_KEY);
      } catch {
        // Browser storage can be disabled; notifications are already deleted on the server.
      }
      renderList();
    } catch (error) {
      await alertDialog({
        title: "Не удалось очистить уведомления",
        message: error?.message || "Попробуйте ещё раз чуть позже.",
        tone: "danger",
      });
    } finally {
      clearAll.disabled = false;
      refresh.disabled = false;
    }
  });

  document.addEventListener("click", (event) => {
    if (!panel.classList.contains("is-open")) return;
    if (root.contains(event.target)) return;
    setOpen(false);
  });

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!panel.classList.contains("is-open")) return;
    setOpen(false);
    button.focus();
  });

  const startPolling = () => {
    if (pollTimer) return;
    pollTimer = window.setInterval(() => {
      if (document.hidden) return;
      void load({ silent: true });
    }, NOTIFICATION_POLL_INTERVAL_MS);
  };

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void load({ silent: true });
  });

  void load();
  startPolling();

  return root;
}

