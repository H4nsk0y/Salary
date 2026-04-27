import { getMyProfile } from "./db.js";

const NAV_STYLE_ID = "alvisa-common-nav-style";

const MAIN_LINKS = [
  { key: "calculator", href: "calculator.html", label: "Калькулятор" },
  { key: "table", href: "table.html", label: "Табель" },
  { key: "schedule", href: "schedule.html", label: "Смены" },
  { key: "profile", href: "profile.html", label: "Профиль" },
  { key: "help", href: "help.html", label: "Справка" },
  { key: "chat", href: "chat.html", label: "Чат" },
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

    .app-top-header .mobile-top-nav {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 0.125rem;
    }

    .app-top-header .mobile-top-nav a {
      white-space: nowrap;
    }

    @media (max-width: 640px) {
      .app-top-header .mobile-top-nav {
        flex-wrap: nowrap !important;
        justify-content: flex-start !important;
        overflow-x: auto !important;
        overflow-y: hidden !important;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        -ms-overflow-style: none;
        max-width: calc(100vw - 92px);
        white-space: nowrap;
        touch-action: pan-x;
      }

      .app-top-header .mobile-top-nav::-webkit-scrollbar {
        display: none;
      }

      .app-top-header .mobile-top-nav a {
        flex: 0 0 auto;
        font-size: 0.72rem !important;
        padding: 5px 7px !important;
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

function linkClass(isActive) {
  const base =
    "nav-link rounded-lg px-3 py-2 md:px-4 transition-all hover:bg-white/5";

  return isActive
    ? `${base} active text-indigo-300`
    : `${base} text-slate-300 hover:text-indigo-200`;
}

function renderLink(link, activeKey) {
  const a = document.createElement("a");
  a.href = link.href;
  a.className = linkClass(link.key === activeKey);
  a.textContent = link.label;
  return a;
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
  nav.className = "mobile-top-nav flex items-center justify-end gap-0.5 text-sm font-medium";
  nav.append(...links.map((link) => renderLink(link, activeKey)));

  inner.append(home, nav);
  header.appendChild(inner);
  mount.replaceWith(header);
  return header;
}

async function enhanceOwnerNavIfNeeded(header) {
  if (!header || header.dataset.ownerNavMode === "false") return;
  if (header.dataset.ownerNavEnhanced === "true") return;

  try {
    const profile = await getMyProfile();
    if (profile?.role !== "owner") return;

    const nav = header.querySelector("nav");
    if (!nav) return;

    const activeKey = header.dataset.activeKey || detectActiveKey();
    nav.append(...OWNER_LINKS.map((link) => renderLink(link, activeKey)));
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
