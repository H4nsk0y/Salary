import {
  deleteMyNotification,
  getMyProfile,
  listMyNotifications,
} from "./db.js";
import "./scrollbar.js";

const NAV_STYLE_ID = "alvisa-common-nav-style";

const MAIN_LINKS = [
  { key: "calculator", href: "calculator.html", label: "Калькулятор" },
  { key: "table", href: "table.html", label: "Табель" },
  { key: "schedule", href: "schedule.html", label: "Смены" },
  { key: "profile", href: "profile.html", label: "Профиль" },
  { key: "updates", href: "updates.html", label: "Новости" },
];

const OWNER_LINKS = [
  { key: "owner-users", href: "owner-users.html", label: "Пользователи" },
  { key: "owner-analytics", href: "owner-analytics.html", label: "Аналитика" },
  { key: "owner", href: "owner.html", label: "Отделы" },
];

function injectNavStyles() {
  if (document.getElementById(NAV_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = NAV_STYLE_ID;
  style.textContent = `
    .app-top-header .nav-link {
      position: relative;
      transition: color 0.2s;
      white-space: nowrap;
    }

    .app-top-header .nav-link::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 1rem;
      right: 1rem;
      height: 2px;
      background: linear-gradient(90deg, #6366f1, #38bdf8);
      border-radius: 2px;
      opacity: 0;
      transform: scaleX(0.7);
      transition: opacity 0.2s, transform 0.2s;
    }

    .app-top-header .nav-link.active::after,
    .app-top-header .nav-link:hover::after {
      opacity: 1;
      transform: scaleX(1);
    }

    .app-top-header .desktop-top-nav {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 0.125rem;
    }

    .app-top-header .desktop-top-nav a {
      white-space: nowrap;
    }

    .app-top-header .app-menu-button {
      display: none;
    }

    .app-top-header .app-header-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 0.5rem;
      min-width: 0;
    }

    .app-top-header .app-notifications {
      position: relative;
      flex: 0 0 auto;
    }

    .app-top-header .app-notification-button {
      position: relative;
      display: inline-flex;
      width: 42px;
      height: 42px;
      align-items: center;
      justify-content: center;
      border-radius: 18px;
      color: rgb(203 213 225);
      background: rgba(255, 255, 255, 0.055);
      border: 1px solid rgba(255, 255, 255, 0.11);
      transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease, transform 0.16s ease;
    }

    .app-top-header .app-notification-button:hover,
    .app-top-header .app-notification-button.is-open {
      color: rgb(224 231 255);
      background: rgba(99, 102, 241, 0.14);
      border-color: rgba(129, 140, 248, 0.28);
    }

    .app-top-header .app-notification-button:active {
      transform: scale(0.98);
    }

    .app-top-header .app-notification-badge {
      position: absolute;
      top: -5px;
      right: -5px;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 999px;
      display: none;
      place-items: center;
      background: rgb(244 63 94);
      color: white;
      font-size: 0.66rem;
      font-weight: 800;
      line-height: 18px;
      box-shadow: 0 0 0 2px rgba(2, 6, 23, 0.96);
    }

    .app-top-header .app-notification-badge.is-visible {
      display: grid;
    }

    .app-top-header .app-notification-panel {
      position: absolute;
      top: calc(100% + 10px);
      right: 0;
      width: min(360px, calc(100vw - 24px));
      max-height: min(520px, calc(100vh - 88px));
      display: none;
      overflow: hidden;
      border-radius: 24px;
      background:
        linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(2, 6, 23, 0.98));
      border: 1px solid rgba(255, 255, 255, 0.12);
      box-shadow: 0 26px 70px rgba(0, 0, 0, 0.48);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }

    .app-top-header .app-notification-panel.is-open {
      display: block;
    }

    .app-top-header .app-notification-panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 14px 10px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    .app-top-header .app-notification-panel-title {
      font-size: 0.9rem;
      font-weight: 800;
      color: rgb(226 232 240);
    }

    .app-top-header .app-notification-refresh {
      border-radius: 999px;
      padding: 6px 9px;
      color: rgb(186 230 253);
      background: rgba(14, 165, 233, 0.10);
      border: 1px solid rgba(56, 189, 248, 0.18);
      font-size: 0.72rem;
      font-weight: 700;
    }

    .app-top-header .app-notification-list {
      max-height: 410px;
      overflow: auto;
      padding: 10px;
    }

    .app-top-header .app-notification-empty,
    .app-top-header .app-notification-error {
      padding: 18px 14px;
      color: rgba(148, 163, 184, 0.95);
      font-size: 0.84rem;
      line-height: 1.45;
    }

    .app-top-header .app-notification-error {
      color: rgb(254 202 202);
    }

    .app-top-header .app-notification-item {
      display: grid;
      gap: 8px;
      border-radius: 18px;
      padding: 12px;
      color: rgb(203 213 225);
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .app-top-header .app-notification-item + .app-notification-item {
      margin-top: 8px;
    }

    .app-top-header .app-notification-title-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
    }

    .app-top-header .app-notification-title {
      color: rgb(241 245 249);
      font-size: 0.84rem;
      font-weight: 800;
      line-height: 1.3;
    }

    .app-top-header .app-notification-delete {
      flex: 0 0 auto;
      width: 26px;
      height: 26px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      color: rgba(203, 213, 225, 0.88);
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .app-top-header .app-notification-delete:hover {
      color: rgb(254 202 202);
      background: rgba(244, 63, 94, 0.12);
      border-color: rgba(248, 113, 113, 0.24);
    }

    .app-top-header .app-notification-body {
      color: rgba(203, 213, 225, 0.92);
      font-size: 0.8rem;
      line-height: 1.45;
    }

    .app-top-header .app-notification-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      color: rgba(148, 163, 184, 0.92);
      font-size: 0.72rem;
    }

    .app-top-header .app-notification-open {
      color: rgb(165 180 252);
      font-weight: 700;
    }

    .app-top-header .app-notification-open:hover {
      color: rgb(199 210 254);
    }

    .app-top-header .app-mobile-menu {
      display: none;
    }

    .app-top-header .mobile-menu-link {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 44px;
      border-radius: 18px;
      padding: 11px 14px;
      color: rgb(203 213 225);
      background: rgba(255, 255, 255, 0.035);
      border: 1px solid rgba(255, 255, 255, 0.08);
      transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease;
    }

    .app-top-header .mobile-menu-link:hover,
    .app-top-header .mobile-menu-link.active {
      color: rgb(224 231 255);
      background: rgba(99, 102, 241, 0.14);
      border-color: rgba(129, 140, 248, 0.24);
    }

    .app-top-header .mobile-menu-link.active::after {
      content: "";
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: rgb(129 140 248);
      box-shadow: 0 0 18px rgba(129, 140, 248, 0.7);
    }

    @media (max-width: 768px) {
      .app-top-header .desktop-top-nav {
        display: none;
      }

      .app-top-header .app-menu-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 42px;
        border-radius: 18px;
        padding: 9px 12px;
        color: rgb(226 232 240);
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.12);
        font-size: 0.86rem;
        font-weight: 700;
        transition: background 0.16s ease, border-color 0.16s ease, transform 0.16s ease;
      }

      .app-top-header .app-notification-panel {
        right: -54px;
      }

      .app-top-header .app-menu-button:hover {
        background: rgba(255, 255, 255, 0.10);
        border-color: rgba(129, 140, 248, 0.32);
      }

      .app-top-header .app-menu-button:active {
        transform: scale(0.98);
      }

      .app-top-header .app-mobile-menu.is-open {
        display: block;
      }

      .app-top-header .app-mobile-menu {
        position: absolute;
        top: calc(100% + 8px);
        left: 12px;
        right: 12px;
        max-height: calc(100vh - 88px);
        overflow-y: auto;
        border-radius: 26px;
        padding: 12px;
        background:
          linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(2, 6, 23, 0.98));
        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 0 26px 70px rgba(0, 0, 0, 0.48);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
      }

      .app-top-header .app-mobile-menu-inner {
        display: grid;
        gap: 8px;
      }

      .app-top-header .app-mobile-menu-caption {
        padding: 2px 4px 8px;
        font-size: 0.72rem;
        font-weight: 700;
        color: rgba(148, 163, 184, 0.92);
        text-transform: uppercase;
        letter-spacing: 0;
      }
    }
  `;

  document.head.appendChild(style);
}

function detectActiveKey() {
  const fileName =
    window.location.pathname.split("/").pop().replace(/\.html$/i, "") || "index";

  if (fileName === "app") return "calculator";
  return fileName;
}

function linkClass(isActive, variant = "desktop") {
  if (variant === "mobile") {
    return isActive ? "mobile-menu-link active" : "mobile-menu-link";
  }

  const base = "nav-link rounded-lg px-3 py-2 md:px-4 transition-all hover:bg-white/5";

  return isActive
    ? `${base} active text-indigo-300`
    : `${base} text-slate-300 hover:text-indigo-200`;
}

function renderLink(link, activeKey, variant = "desktop") {
  const a = document.createElement("a");
  a.href = link.href;
  a.className = linkClass(link.key === activeKey, variant);
  a.textContent = link.label;
  return a;
}

function createMenuIcon() {
  const span = document.createElement("span");
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 7h16"></path>
      <path d="M4 12h16"></path>
      <path d="M4 17h16"></path>
    </svg>
  `;
  return span;
}

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

function createNotificationsWidget() {
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

  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "app-notification-refresh";
  refresh.textContent = "Обновить";

  const list = document.createElement("div");
  list.className = "app-notification-list";
  list.innerHTML = `<div class="app-notification-empty">Загружаю…</div>`;

  head.append(title, refresh);
  panel.append(head, list);
  root.append(button, panel);

  let notifications = [];
  let loaded = false;
  let loading = false;

  const updateBadge = () => {
    const count = notifications.length;
    badge.textContent = count > 9 ? "9+" : String(count);
    badge.classList.toggle("is-visible", count > 0);
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

      const href = String(item.url || "").trim();
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

  const load = async () => {
    if (loading) return;
    loading = true;

    if (!loaded) {
      list.innerHTML = `<div class="app-notification-empty">Загружаю…</div>`;
    }

    try {
      notifications = await listMyNotifications();
      loaded = true;
      renderList();
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
    panel.classList.toggle("is-open", nextOpen);
    button.classList.toggle("is-open", nextOpen);
    button.setAttribute("aria-expanded", String(nextOpen));
    if (nextOpen) void load();
  };

  button.addEventListener("click", () => {
    setOpen(!panel.classList.contains("is-open"));
  });

  refresh.addEventListener("click", () => {
    loaded = false;
    void load();
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

  void load();

  return root;
}

function createMobileMenu(activeKey, links) {
  const menu = document.createElement("div");
  menu.className = "app-mobile-menu";
  menu.id = "appMobileMenu";

  const inner = document.createElement("nav");
  inner.className = "app-mobile-menu-inner";
  inner.dataset.navSlot = "mobile";
  inner.setAttribute("aria-label", "Мобильная навигация");

  const caption = document.createElement("div");
  caption.className = "app-mobile-menu-caption";
  caption.textContent = "Разделы";

  inner.append(caption, ...links.map((link) => renderLink(link, activeKey, "mobile")));
  menu.appendChild(inner);
  return menu;
}

function setupMobileMenu(header, button, menu) {
  const setOpen = (nextOpen) => {
    menu.classList.toggle("is-open", nextOpen);
    button.setAttribute("aria-expanded", String(nextOpen));
  };

  button.addEventListener("click", () => {
    setOpen(!menu.classList.contains("is-open"));
  });

  menu.addEventListener("click", (event) => {
    if (event.target.closest("a")) setOpen(false);
  });

  document.addEventListener("click", (event) => {
    if (!menu.classList.contains("is-open")) return;
    if (header.contains(event.target)) return;
    setOpen(false);
  });

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!menu.classList.contains("is-open")) return;
    setOpen(false);
    button.focus();
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 768) setOpen(false);
  });
}

function renderHeader(mount) {
  const activeKey = mount.dataset.active || detectActiveKey();
  const ownerNavMode = mount.dataset.ownerNav || "auto";
  const showOwnerNav = ownerNavMode === "true";
  const links = showOwnerNav ? [...MAIN_LINKS, ...OWNER_LINKS] : MAIN_LINKS;

  const header = document.createElement("header");
  header.className =
    "app-top-header fixed top-0 inset-x-0 z-50 border-b border-white/10 bg-slate-950/70 backdrop-blur-xl";
  header.dataset.ownerNavMode = ownerNavMode;
  header.dataset.ownerNavEnhanced = showOwnerNav ? "true" : "false";
  header.dataset.activeKey = activeKey;

  const inner = document.createElement("div");
  inner.className =
    "mx-auto max-w-7xl px-4 py-3 md:py-4 flex items-center justify-between gap-2";

  const home = document.createElement("a");
  home.href = "index.html";
  home.className = "group shrink-0";

  const homeText = document.createElement("span");
  homeText.className =
    "text-base md:text-lg font-semibold bg-gradient-to-r from-indigo-200 to-slate-100 bg-clip-text text-transparent transition-colors group-hover:from-indigo-300 group-hover:to-white";
  homeText.textContent = "Главная";
  home.appendChild(homeText);

  const nav = document.createElement("nav");
  nav.className = "desktop-top-nav text-sm font-medium";
  nav.dataset.navSlot = "desktop";
  nav.setAttribute("aria-label", "Основная навигация");
  nav.append(...links.map((link) => renderLink(link, activeKey, "desktop")));

  const actions = document.createElement("div");
  actions.className = "app-header-actions";

  const menuButton = document.createElement("button");
  menuButton.type = "button";
  menuButton.className = "app-menu-button";
  menuButton.setAttribute("aria-controls", "appMobileMenu");
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.append(createMenuIcon(), document.createTextNode("Меню"));

  const mobileMenu = createMobileMenu(activeKey, links);

  actions.append(nav, createNotificationsWidget(), menuButton);
  inner.append(home, actions);
  header.appendChild(inner);
  header.appendChild(mobileMenu);
  mount.replaceWith(header);
  setupMobileMenu(header, menuButton, mobileMenu);
  return header;
}

async function enhanceOwnerNavIfNeeded(header) {
  if (!header || header.dataset.ownerNavMode === "false") return;
  if (header.dataset.ownerNavEnhanced === "true") return;

  try {
    const profile = await getMyProfile();
    if (profile?.role !== "owner") return;

    const activeKey = header.dataset.activeKey || detectActiveKey();
    const desktopNav = header.querySelector('[data-nav-slot="desktop"]');
    const mobileNav = header.querySelector('[data-nav-slot="mobile"]');

    desktopNav?.append(...OWNER_LINKS.map((link) => renderLink(link, activeKey, "desktop")));
    mobileNav?.append(...OWNER_LINKS.map((link) => renderLink(link, activeKey, "mobile")));
    header.dataset.ownerNavEnhanced = "true";
  } catch {
    // Public or expired sessions keep the regular navigation.
  }
}

function initCommonNav() {
  const mount = document.querySelector("[data-app-header]");
  if (!mount) return;

  injectNavStyles();
  const header = renderHeader(mount);
  void enhanceOwnerNavIfNeeded(header);
}

initCommonNav();
