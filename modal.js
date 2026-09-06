const MODAL_STYLE_ID = "appModalStyles";

const ICONS = {
  danger: `
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 9v4"></path>
      <path d="M12 17h.01"></path>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"></path>
    </svg>
  `,
  warning: `
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 20h9"></path>
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
    </svg>
  `,
  info: `
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M12 16v-4"></path>
      <path d="M12 8h.01"></path>
    </svg>
  `,
};

function ensureModalStyles() {
  if (document.getElementById(MODAL_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = MODAL_STYLE_ID;
  style.textContent = `
    .app-modal-overlay {
      position: fixed;
      inset: 0;
      z-index: 260;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      background: rgba(2, 6, 23, 0.82);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }

    .app-modal {
      width: 100%;
      max-width: 440px;
      border-radius: 26px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      background:
        linear-gradient(180deg, rgba(30, 41, 59, 0.98), rgba(15, 23, 42, 0.98));
      box-shadow: 0 28px 90px rgba(0, 0, 0, 0.52);
      color: rgb(241 245 249);
      overflow: hidden;
      transform: translateY(8px) scale(0.98);
      opacity: 0;
      animation: app-modal-in 0.16s ease-out forwards;
    }

    .app-modal::before {
      content: "";
      display: block;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.28), transparent);
    }

    .app-modal-body {
      padding: 22px;
    }

    .app-modal-head {
      display: flex;
      align-items: flex-start;
      gap: 14px;
    }

    .app-modal-icon {
      flex: 0 0 auto;
      display: grid;
      place-items: center;
      width: 46px;
      height: 46px;
      border-radius: 18px;
      border: 1px solid rgba(255, 255, 255, 0.12);
    }

    .app-modal-icon-danger {
      color: rgb(254 202 202);
      background: rgba(244, 63, 94, 0.14);
      box-shadow: inset 0 0 0 1px rgba(251, 113, 133, 0.12);
    }

    .app-modal-icon-warning {
      color: rgb(253 230 138);
      background: rgba(245, 158, 11, 0.14);
      box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.12);
    }

    .app-modal-icon-info {
      color: rgb(191 219 254);
      background: rgba(59, 130, 246, 0.14);
      box-shadow: inset 0 0 0 1px rgba(96, 165, 250, 0.12);
    }

    .app-modal-title {
      margin: 0;
      font-size: 1.08rem;
      font-weight: 750;
      line-height: 1.35;
      letter-spacing: 0;
    }

    .app-modal-message {
      margin: 8px 0 0;
      color: rgba(203, 213, 225, 0.92);
      font-size: 0.92rem;
      line-height: 1.55;
    }

    .app-modal-note {
      margin-top: 14px;
      border-radius: 18px;
      border: 1px solid rgba(255, 255, 255, 0.09);
      background: rgba(2, 6, 23, 0.34);
      padding: 12px 14px;
      color: rgba(226, 232, 240, 0.86);
      font-size: 0.84rem;
      line-height: 1.5;
      white-space: pre-line;
    }

    .app-modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding: 0 22px 22px;
      flex-wrap: wrap;
    }

    .app-modal-btn {
      appearance: none;
      border: none;
      min-height: 44px;
      border-radius: 16px;
      padding: 10px 16px;
      font-size: 0.9rem;
      font-weight: 700;
      cursor: pointer;
      transition: transform 0.16s ease, background 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
    }

    .app-modal-btn:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.26);
    }

    .app-modal-btn:active {
      transform: scale(0.98);
    }

    .app-modal-btn-secondary {
      color: rgb(226 232 240);
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.11);
    }

    .app-modal-btn-secondary:hover {
      background: rgba(255, 255, 255, 0.10);
      border-color: rgba(255, 255, 255, 0.16);
    }

    .app-modal-btn-primary {
      color: white;
      background: linear-gradient(135deg, #4f46e5 0%, #2563eb 100%);
      box-shadow: 0 14px 30px rgba(37, 99, 235, 0.22);
    }

    .app-modal-btn-primary:hover {
      box-shadow: 0 16px 36px rgba(37, 99, 235, 0.30);
    }

    .app-modal-btn-danger {
      color: white;
      background: linear-gradient(135deg, #e11d48 0%, #be123c 100%);
      box-shadow: 0 14px 30px rgba(225, 29, 72, 0.22);
    }

    .app-modal-btn-danger:hover {
      box-shadow: 0 16px 36px rgba(225, 29, 72, 0.30);
    }

    .app-modal-btn-warning {
      color: rgb(15 23 42);
      background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
      box-shadow: 0 14px 30px rgba(245, 158, 11, 0.20);
    }

    @keyframes app-modal-in {
      to {
        transform: translateY(0) scale(1);
        opacity: 1;
      }
    }

    @media (max-width: 420px) {
      .app-modal-body {
        padding: 20px;
      }

      .app-modal-actions {
        padding: 0 20px 20px;
      }

      .app-modal-actions .app-modal-btn {
        flex: 1 1 100%;
      }
    }

    @font-face {
      font-family: "Anticva";
      src: url("./fonts/Anticva-Regular.otf") format("opentype");
      font-display: swap;
    }

    .app-modal-overlay {
      padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom));
      background: rgba(5, 6, 7, 0.84);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }

    .app-modal {
      max-width: 460px;
      border-radius: 9px;
      border-color: rgba(241, 238, 232, 0.14);
      background: #15191d;
      box-shadow: 0 32px 100px rgba(0, 0, 0, 0.58);
      color: #f1eee8;
      transform: translateY(10px);
      animation: app-modal-in 0.2s cubic-bezier(.2,.8,.3,1) forwards;
    }

    .app-modal::before { display: none; }
    .app-modal-body { padding: 24px 24px 20px; }
    .app-modal-head { gap: 16px; }
    .app-modal-icon { width: 42px; height: 42px; border-radius: 6px; border-color: rgba(241, 238, 232, 0.13); }
    .app-modal-icon-danger { color: #efb4c5; background: rgba(122, 22, 56, 0.24); box-shadow: none; }
    .app-modal-icon-warning { color: #dfc48d; background: rgba(198, 161, 91, 0.14); box-shadow: none; }
    .app-modal-icon-info { color: #a9c9eb; background: rgba(110, 168, 232, 0.12); box-shadow: none; }

    .app-modal-title {
      font-family: "Anticva", Georgia, serif;
      font-size: 1.55rem;
      font-weight: 400;
      line-height: 1.12;
      color: #f1eee8;
    }

    .app-modal-message { margin-top: 10px; color: #a9a5a0; font-size: 0.9rem; line-height: 1.6; }
    .app-modal-note {
      margin-top: 16px;
      border-radius: 6px;
      border-color: rgba(241, 238, 232, 0.10);
      border-left: 3px solid rgba(198, 161, 91, 0.62);
      background: rgba(11, 13, 15, 0.54);
      color: #c4c0ba;
    }

    .app-modal-actions { padding: 16px 24px 24px; border-top: 1px solid rgba(241, 238, 232, 0.09); }
    .app-modal-btn { border: 1px solid transparent; border-radius: 6px; box-shadow: none; }
    .app-modal-btn:focus-visible { box-shadow: 0 0 0 3px rgba(198, 161, 91, 0.18); }
    .app-modal-btn-secondary { color: #d7d3cd; background: rgba(241, 238, 232, 0.05); border-color: rgba(241, 238, 232, 0.11); }
    .app-modal-btn-secondary:hover { background: rgba(241, 238, 232, 0.09); border-color: rgba(241, 238, 232, 0.18); }
    .app-modal-btn-primary { color: #fff7f8; background: #7a1638; border-color: #7a1638; box-shadow: none; }
    .app-modal-btn-primary:hover { background: #8c1b42; border-color: #8c1b42; box-shadow: none; }
    .app-modal-btn-danger { color: #fff7f8; background: #7a1638; border-color: #a44664; box-shadow: none; }
    .app-modal-btn-danger:hover { background: #921d46; box-shadow: none; }
    .app-modal-btn-warning { color: #17130d; background: #c6a15b; border-color: #d6b777; box-shadow: none; }
    .app-modal-btn-warning:hover { background: #d1ad68; }

    @media (max-width: 420px) {
      .app-modal-body { padding: 20px 18px 17px; }
      .app-modal-actions { padding: 14px 18px 18px; }
    }

    @media (prefers-reduced-motion: reduce) {
      .app-modal {
        animation: none;
        transform: none;
        opacity: 1;
      }
    }
  `;
  document.head.appendChild(style);
}

function normalizeTone(tone) {
  return ["danger", "warning", "info"].includes(tone) ? tone : "info";
}

function getFocusable(container) {
  return Array.from(
    container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => !el.disabled && el.offsetParent !== null);
}

function setText(el, text) {
  el.textContent = String(text ?? "");
}

export function confirmDialog({
  title = "Подтвердить действие",
  message = "Вы уверены?",
  note = "",
  confirmText = "Подтвердить",
  cancelText = "Отмена",
  tone = "info",
  closeOnBackdrop = true,
} = {}) {
  ensureModalStyles();

  const modalTone = normalizeTone(tone);
  const previousActive = document.activeElement;
  const previousOverflow = document.body.style.overflow;

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "app-modal-overlay";

    const modal = document.createElement("div");
    modal.className = "app-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "appModalTitle");
    modal.setAttribute("aria-describedby", "appModalMessage");

    const body = document.createElement("div");
    body.className = "app-modal-body";

    const head = document.createElement("div");
    head.className = "app-modal-head";

    const icon = document.createElement("div");
    icon.className = `app-modal-icon app-modal-icon-${modalTone}`;
    icon.innerHTML = ICONS[modalTone] || ICONS.info;

    const textWrap = document.createElement("div");

    const titleEl = document.createElement("h3");
    titleEl.id = "appModalTitle";
    titleEl.className = "app-modal-title";
    setText(titleEl, title);

    const messageEl = document.createElement("p");
    messageEl.id = "appModalMessage";
    messageEl.className = "app-modal-message";
    setText(messageEl, message);

    textWrap.appendChild(titleEl);
    textWrap.appendChild(messageEl);
    head.appendChild(icon);
    head.appendChild(textWrap);
    body.appendChild(head);

    if (note) {
      const noteEl = document.createElement("div");
      noteEl.className = "app-modal-note";
      setText(noteEl, note);
      body.appendChild(noteEl);
    }

    const actions = document.createElement("div");
    actions.className = "app-modal-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "app-modal-btn app-modal-btn-secondary";
    setText(cancelBtn, cancelText);
    cancelBtn.hidden = !cancelText;

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = `app-modal-btn app-modal-btn-${modalTone === "danger" ? "danger" : modalTone === "warning" ? "warning" : "primary"}`;
    setText(confirmBtn, confirmText);

    if (cancelText) actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    modal.appendChild(body);
    modal.appendChild(actions);
    overlay.appendChild(modal);

    let settled = false;

    const cleanup = (value) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      overlay.remove();

      if (previousActive && typeof previousActive.focus === "function") {
        requestAnimationFrame(() => previousActive.focus());
      }

      resolve(value);
    };

    function onKeyDown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        cleanup(false);
        return;
      }

      if (e.key !== "Tab") return;

      const focusable = getFocusable(modal);
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    overlay.addEventListener("mousedown", (e) => {
      if (!closeOnBackdrop || e.target !== overlay) return;
      cleanup(false);
    });
    cancelBtn.addEventListener("click", () => cleanup(false));
    confirmBtn.addEventListener("click", () => cleanup(true));
    window.addEventListener("keydown", onKeyDown);

    document.body.style.overflow = "hidden";
    document.body.appendChild(overlay);
    requestAnimationFrame(() => confirmBtn.focus());
  });
}

export function alertDialog({
  title = "Сообщение",
  message = "",
  buttonText = "Понятно",
  tone = "info",
} = {}) {
  return confirmDialog({
    title,
    message,
    confirmText: buttonText,
    cancelText: "",
    tone,
    closeOnBackdrop: true,
  });
}
