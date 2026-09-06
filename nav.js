import {
  deleteAllMyNotifications,
  deleteMyNotification,
  getMyProfile,
  listMyNotifications,
  markMyNotificationsRead,
} from "./db.js";
import { alertDialog, confirmDialog } from "./modal.js";
import {
  buildProfileCompletionUrl,
  getMissingRequiredProfileFields,
  normalizeInternalNextUrl,
} from "./profileCompletion.js";
import { installErrorLogger } from "./errorLogger.js";
import "./pwa.js";
import "./scrollbar.js";
import "./footer.js?v=20260802-2";

installErrorLogger();

const NAV_STYLE_ID = "alvisa-common-nav-style";
const NOTIFICATION_READ_STORAGE_KEY = "alvisa.notificationReadIds.v1";
const NOTIFICATION_POLL_INTERVAL_MS = 45000;
const CURRENT_UPDATES_VERSION = "29.0";
const UPDATES_SEEN_STORAGE_KEY = "alvisa.updatesSeenVersion.v1";
const UPDATES_PROMPT_SESSION_KEY = "alvisa.updatesPromptedVersion.v1";

const MAIN_LINKS = [
  { key: "calculator", href: "calculator.html", label: "Калькулятор" },
  { key: "table", href: "table.html", label: "Табель" },
  { key: "schedule", href: "schedule.html", label: "Смены" },
  { key: "checklist", href: "checklist.html", label: "Чек-лист" },
  { key: "profile", href: "profile.html", label: "Профиль" },
];

const OWNER_LINKS = [
  { key: "owner", href: "owner.html", label: "Отделы" },
];

function injectNavStyles() {
  if (document.getElementById(NAV_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = NAV_STYLE_ID;
  style.textContent = `
    .app-top-safe-area-cover {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: env(safe-area-inset-top, 0px);
      pointer-events: none;
      z-index: 49;
      background: rgba(2, 6, 23, 0.96);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }

    .app-top-header {
      top: 0;
      padding-top: env(safe-area-inset-top, 0px);
    }

    .pt-safe {
      padding-top: calc(7rem + env(safe-area-inset-top, 0px)) !important;
    }

    .app-header-offset {
      padding-top: calc(6rem + env(safe-area-inset-top, 0px)) !important;
    }

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

    .app-top-header .app-notification-panel-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
      min-width: 0;
    }

    .app-top-header .app-notification-clear,
    .app-top-header .app-notification-refresh {
      min-height: 30px;
      border-radius: 999px;
      padding: 6px 9px;
      font-size: 0.72rem;
      font-weight: 700;
      transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease, opacity 0.16s ease;
    }

    .app-top-header .app-notification-clear {
      color: rgb(254 202 202);
      background: rgba(244, 63, 94, 0.08);
      border: 1px solid rgba(248, 113, 113, 0.16);
    }

    .app-top-header .app-notification-clear:hover {
      color: rgb(255 228 230);
      background: rgba(244, 63, 94, 0.14);
      border-color: rgba(248, 113, 113, 0.28);
    }

    .app-top-header .app-notification-clear:disabled,
    .app-top-header .app-notification-refresh:disabled {
      cursor: default;
      opacity: 0.5;
    }

    .app-top-header .app-notification-refresh {
      color: rgb(186 230 253);
      background: rgba(14, 165, 233, 0.10);
      border: 1px solid rgba(56, 189, 248, 0.18);
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

    .app-top-header .app-notification-item.is-unread {
      border-color: rgba(129, 140, 248, 0.30);
      background: rgba(99, 102, 241, 0.075);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.035);
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
        position: fixed;
        top: calc(env(safe-area-inset-top, 0px) + 72px);
        left: 10px;
        right: 10px;
        width: auto;
        max-height: calc(100vh - 84px);
        max-height: calc(100dvh - 92px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
        border-radius: 22px;
      }

      .app-top-header .app-notification-list {
        max-height: calc(100vh - 158px);
        max-height: calc(100dvh - 166px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
        overscroll-behavior: contain;
      }

      .app-top-header .app-notification-title,
      .app-top-header .app-notification-body {
        overflow-wrap: anywhere;
      }

      .app-top-header .app-notification-meta {
        flex-wrap: wrap;
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
        max-height: calc(100vh - 96px);
        max-height: calc(100dvh - 96px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
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

    @media (min-width: 768px) {
      .pt-safe {
        padding-top: calc(6rem + env(safe-area-inset-top, 0px)) !important;
      }

      .app-header-offset {
        padding-top: calc(7rem + env(safe-area-inset-top, 0px)) !important;
      }
    }

    /* ALVISA navigation */
    @font-face {
      font-family: "Anticva";
      src: url("./fonts/Anticva-Regular.otf") format("opentype");
      font-display: swap;
    }

    .app-top-safe-area-cover {
      background: rgba(11, 13, 15, 0.97);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }

    .app-top-header {
      background: rgba(11, 13, 15, 0.92) !important;
      border-color: rgba(241, 238, 232, 0.13) !important;
      box-shadow: 0 10px 34px rgba(0, 0, 0, 0.16);
      color: #f1eee8;
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
    }

    .app-top-header > div:first-child {
      width: min(1440px, 100%);
      max-width: 1440px !important;
      min-height: 70px;
      padding-top: 12px !important;
      padding-bottom: 12px !important;
    }

    .app-top-header > div:first-child > a.group {
      display: inline-flex;
      align-items: center;
      min-height: 40px;
      color: #f1eee8;
      text-decoration: none;
    }

    .app-top-header > div:first-child > a.group > span {
      background: none !important;
      color: #f1eee8 !important;
      font-family: Anticva, Georgia, serif;
      font-size: 1.55rem !important;
      font-weight: 400 !important;
      line-height: 1;
    }

    .app-top-header .app-header-actions {
      gap: 8px;
    }

    .app-top-header .desktop-top-nav {
      gap: 0;
    }

    .app-top-header .desktop-top-nav .nav-link {
      min-height: 40px;
      display: inline-flex;
      align-items: center;
      border-radius: 0 !important;
      padding: 8px 11px !important;
      background: transparent !important;
      color: #a8adb2 !important;
      font-size: 0.78rem;
      font-weight: 600;
      transition: color 180ms ease;
    }

    .app-top-header .desktop-top-nav .nav-link:hover,
    .app-top-header .desktop-top-nav .nav-link.active {
      background: transparent !important;
      color: #f1eee8 !important;
    }

    .app-top-header .nav-link::after {
      bottom: 1px;
      left: 11px;
      right: 11px;
      height: 1px;
      border-radius: 0;
      background: #6ea8e8;
      transform: scaleX(0.35);
      transform-origin: center;
    }

    .app-top-header .nav-link.active::after,
    .app-top-header .nav-link:hover::after {
      transform: scaleX(1);
    }

    .app-top-header .app-notification-button,
    .app-top-header .app-menu-button {
      min-height: 40px;
      border: 1px solid rgba(241, 238, 232, 0.14);
      border-radius: 8px;
      background: rgba(241, 238, 232, 0.04);
      color: #c6c9cc;
      box-shadow: none;
    }

    .app-top-header .app-notification-button {
      width: 40px;
      height: 40px;
    }

    .app-top-header .app-notification-button:hover,
    .app-top-header .app-notification-button.is-open,
    .app-top-header .app-menu-button:hover {
      border-color: rgba(110, 168, 232, 0.35);
      background: rgba(110, 168, 232, 0.08);
      color: #d8ebff;
    }

    .app-top-header .app-notification-badge {
      top: -4px;
      right: -4px;
      min-width: 17px;
      height: 17px;
      padding: 0 4px;
      background: #7a1638;
      font-size: 0.62rem;
      line-height: 17px;
      box-shadow: 0 0 0 2px #0b0d0f;
    }

    .app-top-header .app-notification-panel {
      top: calc(100% + 9px);
      width: min(380px, calc(100vw - 24px));
      border: 1px solid rgba(241, 238, 232, 0.14);
      border-radius: 10px;
      background: rgba(17, 20, 23, 0.98);
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.38);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
    }

    .app-top-header .app-notification-panel-head {
      min-height: 54px;
      padding: 11px 12px;
      border-color: rgba(241, 238, 232, 0.1);
    }

    .app-top-header .app-notification-panel-title {
      color: #f1eee8;
      font-family: Anticva, Georgia, serif;
      font-size: 1.08rem;
      font-weight: 400;
    }

    .app-top-header .app-notification-clear,
    .app-top-header .app-notification-refresh {
      min-height: 30px;
      border-radius: 5px;
      background: rgba(241, 238, 232, 0.04);
      border-color: rgba(241, 238, 232, 0.12);
      color: #a8adb2;
    }

    .app-top-header .app-notification-clear {
      color: #e7a7bb;
    }

    .app-top-header .app-notification-clear:hover,
    .app-top-header .app-notification-refresh:hover {
      border-color: rgba(241, 238, 232, 0.22);
      background: rgba(241, 238, 232, 0.08);
      color: #f1eee8;
    }

    .app-top-header .app-notification-list {
      padding: 8px;
    }

    .app-top-header .app-notification-item {
      gap: 7px;
      border: 1px solid rgba(241, 238, 232, 0.1);
      border-radius: 7px;
      background: #0f1214;
      color: #c6c9cc;
    }

    .app-top-header .app-notification-item.is-unread {
      border-color: rgba(110, 168, 232, 0.3);
      background: rgba(110, 168, 232, 0.055);
      box-shadow: none;
    }

    .app-top-header .app-notification-title {
      color: #f1eee8;
    }

    .app-top-header .app-notification-body {
      color: #b5b9bd;
    }

    .app-top-header .app-notification-meta,
    .app-top-header .app-notification-empty {
      color: #858b90;
    }

    .app-top-header .app-notification-open {
      color: #8cbcf0;
    }

    .app-top-header .app-notification-delete {
      border-radius: 5px;
      background: rgba(241, 238, 232, 0.04);
      border-color: rgba(241, 238, 232, 0.1);
      color: #969ca2;
    }

    .app-top-header .app-mobile-menu {
      border: 1px solid rgba(241, 238, 232, 0.14);
      border-radius: 10px;
      background: rgba(17, 20, 23, 0.98);
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.38);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
    }

    .app-top-header .app-mobile-menu-caption {
      color: #777d82;
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0;
    }

    .app-top-header .mobile-menu-link {
      min-height: 42px;
      border: 1px solid rgba(241, 238, 232, 0.1);
      border-radius: 7px;
      background: rgba(241, 238, 232, 0.025);
      color: #b5b9bd;
      font-size: 0.86rem;
      font-weight: 600;
    }

    .app-top-header .mobile-menu-link:hover,
    .app-top-header .mobile-menu-link.active {
      border-color: rgba(110, 168, 232, 0.28);
      background: rgba(110, 168, 232, 0.07);
      color: #f1eee8;
    }

    .app-top-header .mobile-menu-link.active::after {
      width: 6px;
      height: 6px;
      background: #6ea8e8;
      box-shadow: none;
    }

    @media (max-width: 1120px) {
      .app-top-header > div:first-child {
        min-height: 66px;
        padding-top: 10px !important;
        padding-bottom: 10px !important;
      }

      .app-top-header .desktop-top-nav {
        display: none;
      }

      .app-top-header .app-menu-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        padding: 8px 11px;
        font-size: 0.8rem;
        font-weight: 700;
      }

      .app-top-header .app-mobile-menu.is-open {
        display: block;
      }

      .app-top-header .app-mobile-menu {
        position: absolute;
        top: calc(100% + 8px);
        left: 12px;
        right: 12px;
        max-height: calc(100dvh - 96px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
        overflow-y: auto;
        padding: 10px;
      }

      .app-top-header .app-mobile-menu-inner {
        display: grid;
        gap: 6px;
      }

      .app-top-header .app-notification-panel {
        position: fixed;
        top: calc(env(safe-area-inset-top, 0px) + 72px);
        left: 10px;
        right: 10px;
        width: auto;
        max-height: calc(100dvh - 84px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
      }

      .app-top-header .app-notification-list {
        max-height: calc(100dvh - 158px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
      }
    }

    @media (max-width: 430px) {
      .app-top-header > div:first-child {
        padding-left: 14px !important;
        padding-right: 14px !important;
      }

      .app-top-header > div:first-child > a.group > span {
        font-size: 1.35rem !important;
      }

      .app-top-header .app-header-actions {
        gap: 6px;
      }

      .app-top-header .app-menu-button {
        width: 40px;
        padding: 0;
        font-size: 0;
        gap: 0;
      }

      .app-top-header .app-menu-button span {
        display: inline-flex;
      }

      .app-top-header .app-notification-panel-head {
        align-items: flex-start;
      }

      .app-top-header .app-notification-panel-actions {
        gap: 5px;
      }

      .app-top-header .app-notification-clear,
      .app-top-header .app-notification-refresh {
        padding-inline: 7px;
        font-size: 0.67rem;
      }
    }

    @media (min-width: 1121px) {
      .app-top-header .desktop-top-nav {
        display: flex;
      }

      .app-top-header .app-menu-button,
      .app-top-header .app-mobile-menu {
        display: none !important;
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

function markCurrentUpdatesSeen() {
  try { localStorage.setItem(UPDATES_SEEN_STORAGE_KEY, CURRENT_UPDATES_VERSION); } catch {}
}

function scheduleUnreadUpdatesPrompt(activeKey) {
  if (["updates", "login", "register"].includes(activeKey)) return;

  try {
    if (localStorage.getItem(UPDATES_SEEN_STORAGE_KEY) === CURRENT_UPDATES_VERSION) return;
    if (sessionStorage.getItem(UPDATES_PROMPT_SESSION_KEY) === CURRENT_UPDATES_VERSION) return;
    sessionStorage.setItem(UPDATES_PROMPT_SESSION_KEY, CURRENT_UPDATES_VERSION);
  } catch {
    return;
  }

  window.setTimeout(async () => {
    const openUpdates = await confirmDialog({
      title: "В ALVISA SALARY появились изменения",
      message: "Личный табель стал удобнее для просмотра графика, ночных смен и дней выхода на работу.",
      note: "Откройте короткое описание обновления, чтобы ничего важного не пропустить.",
      confirmText: "Посмотреть",
      cancelText: "Позже",
      tone: "info",
    });
    if (openUpdates) window.location.href = "updates.html";
  }, 1100);
}

function linkClass(isActive, variant = "desktop") {
  if (variant === "mobile") {
    return isActive ? "mobile-menu-link active" : "mobile-menu-link";
  }

  const base = "nav-link px-3 py-2 transition-all";

  return isActive
    ? `${base} active text-indigo-300`
    : `${base} text-slate-300 hover:text-indigo-200`;
}

function renderLink(link, activeKey, variant = "desktop") {
  const a = document.createElement("a");
  a.href = link.href;
  a.className = linkClass(link.key === activeKey, variant);
  a.dataset.navKey = link.key;
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
    if (window.innerWidth > 1120) setOpen(false);
  });
}

function applyProfileNavPreferences(header, profile) {
  if (!header || !profile) return;

  if (profile.hide_calculator_nav === true) {
    header
      .querySelectorAll('[data-nav-key="calculator"]')
      .forEach((link) => link.remove());
  }
}

function installProfileCompletionNavigationGate(header, profile) {
  header._missingRequiredProfileFields = getMissingRequiredProfileFields(profile);
  if (header.dataset.profileCompletionGate === "true") return;
  header.dataset.profileCompletionGate = "true";

  header.addEventListener("click", (event) => {
    const missing = header._missingRequiredProfileFields || [];
    if (!missing.length) return;
    const link = event.target.closest("a");
    if (!link || !header.contains(link)) return;
    const key = link.dataset.navKey || "home";
    if (key === "calculator" || key === "profile") return;

    event.preventDefault();
    const nextUrl = normalizeInternalNextUrl(link.href, "table.html");
    window.location.href = buildProfileCompletionUrl(nextUrl, missing);
  }, true);
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
  home.dataset.navKey = "home";
  home.className = "group shrink-0";
  home.setAttribute("aria-label", "ALVISA SALARY — главная");

  const homeText = document.createElement("span");
  homeText.className =
    "text-base md:text-lg font-semibold bg-gradient-to-r from-indigo-200 to-slate-100 bg-clip-text text-transparent transition-colors group-hover:from-indigo-300 group-hover:to-white";
  homeText.textContent = "ALVISA SALARY";
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
  const safeAreaCover = document.createElement("div");
  safeAreaCover.className = "app-top-safe-area-cover";
  safeAreaCover.setAttribute("aria-hidden", "true");

  mount.replaceWith(safeAreaCover, header);
  setupMobileMenu(header, menuButton, mobileMenu);
  window.addEventListener("alvisa:profile-updated", (event) => {
    installProfileCompletionNavigationGate(header, event.detail?.profile);
  });
  return header;
}

async function enhanceNavForProfile(header) {
  if (!header) return;

  try {
    const profile = await getMyProfile();
    installProfileCompletionNavigationGate(header, profile);
    applyProfileNavPreferences(header, profile);

    const activeKey = header.dataset.activeKey || detectActiveKey();
    if (profile?.user_id) scheduleUnreadUpdatesPrompt(activeKey);
    const desktopNav = header.querySelector('[data-nav-slot="desktop"]');
    const mobileNav = header.querySelector('[data-nav-slot="mobile"]');
    if (header.dataset.ownerNavMode === "false") return;
    if (header.dataset.ownerNavEnhanced === "true") return;
    if (profile?.role !== "owner") return;

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
  if (detectActiveKey() === "updates") markCurrentUpdatesSeen();
  const header = renderHeader(mount);
  void enhanceNavForProfile(header);
}

initCommonNav();
