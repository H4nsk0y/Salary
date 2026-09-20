const NOTICE_STYLE_ID = "alvisaConnectionNoticeStyle";
const NOTICE_ID = "alvisaConnectionNotice";
const SLOW_SUPABASE_REQUEST_MS = 9000;
const NOTICE_COOLDOWN_MS = 45000;

let lastNoticeAt = 0;
let hideTimer = null;

function canUseDom() {
  return typeof document !== "undefined" && Boolean(document.body);
}

function ensureNoticeStyles() {
  if (!canUseDom() || document.getElementById(NOTICE_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = NOTICE_STYLE_ID;
  style.textContent = `
    .alvisa-connection-notice {
      position: fixed;
      right: 16px;
      bottom: calc(16px + env(safe-area-inset-bottom, 0px));
      z-index: 320;
      width: min(430px, calc(100vw - 32px));
      display: grid;
      grid-template-columns: 38px minmax(0, 1fr) auto;
      gap: 12px;
      align-items: start;
      padding: 14px;
      border-radius: 24px;
      border: 1px solid rgba(251, 191, 36, 0.24);
      background:
        linear-gradient(180deg, rgba(30, 41, 59, 0.98), rgba(15, 23, 42, 0.98));
      color: rgb(226 232 240);
      box-shadow: 0 24px 70px rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      opacity: 0;
      pointer-events: none;
      transform: translateY(12px);
      transition: opacity 0.18s ease, transform 0.18s ease;
    }

    .alvisa-connection-notice.is-visible {
      opacity: 1;
      pointer-events: auto;
      transform: translateY(0);
    }

    .alvisa-connection-notice.is-danger {
      border-color: rgba(248, 113, 113, 0.30);
    }

    .alvisa-connection-notice-icon {
      display: grid;
      place-items: center;
      width: 38px;
      height: 38px;
      border-radius: 16px;
      color: rgb(253 230 138);
      background: rgba(245, 158, 11, 0.14);
      border: 1px solid rgba(251, 191, 36, 0.16);
    }

    .alvisa-connection-notice.is-danger .alvisa-connection-notice-icon {
      color: rgb(254 202 202);
      background: rgba(244, 63, 94, 0.14);
      border-color: rgba(248, 113, 113, 0.18);
    }

    .alvisa-connection-notice-title {
      font-size: 0.9rem;
      font-weight: 800;
      line-height: 1.25;
      color: rgb(248 250 252);
    }

    .alvisa-connection-notice-message {
      margin-top: 4px;
      font-size: 0.82rem;
      line-height: 1.45;
      color: rgba(203, 213, 225, 0.92);
    }

    .alvisa-connection-notice-actions {
      margin-top: 10px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .alvisa-connection-notice-action,
    .alvisa-connection-notice-close {
      appearance: none;
      border: 1px solid rgba(255, 255, 255, 0.10);
      color: rgb(226 232 240);
      background: rgba(255, 255, 255, 0.06);
      cursor: pointer;
      transition: background 0.16s ease, border-color 0.16s ease, transform 0.16s ease;
    }

    .alvisa-connection-notice-action {
      border-radius: 999px;
      padding: 7px 10px;
      font-size: 0.74rem;
      font-weight: 800;
    }

    .alvisa-connection-notice-close {
      width: 30px;
      height: 30px;
      border-radius: 999px;
      line-height: 1;
      font-size: 1.1rem;
    }

    .alvisa-connection-notice-action:hover,
    .alvisa-connection-notice-close:hover {
      background: rgba(255, 255, 255, 0.10);
      border-color: rgba(255, 255, 255, 0.16);
    }

    .alvisa-connection-notice-action:active,
    .alvisa-connection-notice-close:active {
      transform: scale(0.98);
    }

    @media (max-width: 520px) {
      .alvisa-connection-notice {
        left: 12px;
        right: 12px;
        bottom: calc(12px + env(safe-area-inset-bottom, 0px));
        width: auto;
        grid-template-columns: 34px minmax(0, 1fr) auto;
        border-radius: 22px;
        padding: 12px;
      }

      .alvisa-connection-notice-icon {
        width: 34px;
        height: 34px;
        border-radius: 14px;
      }
    }

    .alvisa-connection-notice {
      grid-template-columns: 36px minmax(0, 1fr) auto;
      border-radius: 8px;
      border-color: rgba(198, 161, 91, 0.32);
      background: #15191d;
      color: #f1eee8;
      box-shadow: 0 24px 70px rgba(0, 0, 0, 0.48);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }

    .alvisa-connection-notice.is-danger { border-color: rgba(164, 70, 100, 0.58); }
    .alvisa-connection-notice-icon {
      width: 36px;
      height: 36px;
      border-radius: 5px;
      color: #dfc48d;
      background: rgba(198, 161, 91, 0.12);
      border-color: rgba(198, 161, 91, 0.24);
    }

    .alvisa-connection-notice.is-danger .alvisa-connection-notice-icon {
      color: #efb4c5;
      background: rgba(122, 22, 56, 0.24);
      border-color: rgba(164, 70, 100, 0.35);
    }

    .alvisa-connection-notice-title { color: #f1eee8; font-size: 0.92rem; }
    .alvisa-connection-notice-message { color: #aaa6a0; line-height: 1.55; }
    .alvisa-connection-notice-action {
      border-radius: 5px;
      border-color: #7a1638;
      background: #7a1638;
      color: #fff7f8;
    }
    .alvisa-connection-notice-action:hover { border-color: #8c1b42; background: #8c1b42; }
    .alvisa-connection-notice-close {
      width: 28px;
      height: 28px;
      border-radius: 5px;
      border-color: rgba(241, 238, 232, 0.10);
      background: rgba(241, 238, 232, 0.04);
      color: #b9b5af;
    }

    @media (max-width: 520px) {
      .alvisa-connection-notice {
        left: 10px;
        right: 10px;
        bottom: calc(10px + env(safe-area-inset-bottom, 0px));
        width: auto;
        grid-template-columns: 34px minmax(0, 1fr) auto;
        border-radius: 7px;
        padding: 12px;
      }
      .alvisa-connection-notice-icon { width: 34px; height: 34px; border-radius: 5px; }
    }
  `;
  document.head.appendChild(style);
}

function createNoticeElement() {
  const notice = document.createElement("div");
  notice.id = NOTICE_ID;
  notice.className = "alvisa-connection-notice";
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  notice.innerHTML = `
    <div class="alvisa-connection-notice-icon" aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 9v4"></path>
        <path d="M12 17h.01"></path>
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"></path>
      </svg>
    </div>
    <div class="alvisa-connection-notice-content">
      <div class="alvisa-connection-notice-title"></div>
      <div class="alvisa-connection-notice-message"></div>
      <div class="alvisa-connection-notice-actions">
        <button class="alvisa-connection-notice-action" type="button">Обновить страницу</button>
      </div>
    </div>
    <button class="alvisa-connection-notice-close" type="button" aria-label="Закрыть">×</button>
  `;

  notice.querySelector(".alvisa-connection-notice-close")?.addEventListener("click", () => {
    notice.classList.remove("is-visible");
  });
  notice.querySelector(".alvisa-connection-notice-action")?.addEventListener("click", () => {
    window.location.reload();
  });

  document.body.appendChild(notice);
  return notice;
}

function showConnectionNotice({ title, message, tone = "warning" }, { force = false, duration = 12000 } = {}) {
  if (!canUseDom()) {
    if (typeof document !== "undefined") {
      document.addEventListener("DOMContentLoaded", () => {
        showConnectionNotice({ title, message, tone }, { force, duration });
      }, { once: true });
    }
    return;
  }

  const now = Date.now();
  if (!force && now - lastNoticeAt < NOTICE_COOLDOWN_MS) return;
  lastNoticeAt = now;

  ensureNoticeStyles();

  const notice = document.getElementById(NOTICE_ID) || createNoticeElement();
  notice.classList.toggle("is-danger", tone === "danger");
  notice.querySelector(".alvisa-connection-notice-title").textContent = title;
  notice.querySelector(".alvisa-connection-notice-message").textContent = message;

  window.clearTimeout(hideTimer);
  requestAnimationFrame(() => notice.classList.add("is-visible"));

  hideTimer = window.setTimeout(() => {
    notice.classList.remove("is-visible");
  }, duration);
}

export function createSupabaseFetch(nativeFetch = globalThis.fetch) {
  return async function supabaseFetchWithNotice(input, init) {
    const fetchImpl = typeof nativeFetch === "function" ? nativeFetch : globalThis.fetch;
    let slowTimer = null;

    if (typeof window !== "undefined") {
      slowTimer = window.setTimeout(() => {
        showConnectionNotice({
          title: "Данные загружаются слишком долго",
          message: "Если сайт открыт из России, попробуйте включить VPN и обновить страницу.",
        });
      }, SLOW_SUPABASE_REQUEST_MS);
    }

    try {
      return await fetchImpl.call(globalThis, input, init);
    } catch (error) {
      showConnectionNotice({
        title: "Не получается подключиться к базе",
        message: "Проверьте интернет. Если сайт открыт из России, включите VPN и обновите страницу.",
        tone: "danger",
      }, { force: true, duration: 15000 });
      throw error;
    } finally {
      if (slowTimer) window.clearTimeout(slowTimer);
    }
  };
}
