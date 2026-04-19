export const EYE_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"></path>
    <circle cx="12" cy="12" r="3"></circle>
  </svg>
`;

export const EYE_OFF_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M10.733 5.076A10.744 10.744 0 0 1 12 5c6.5 0 10 7 10 7a16.88 16.88 0 0 1-1.67 2.68"></path>
    <path d="M6.61 6.61A16.88 16.88 0 0 0 2 12s3.5 7 10 7a10.75 10.75 0 0 0 5.39-1.61"></path>
    <path d="M8.71 8.71a3 3 0 0 0 4.58 4.58"></path>
    <path d="M9.88 9.88a3 3 0 0 1 4.24 4.24"></path>
    <path d="M2 2l20 20"></path>
  </svg>
`;

const PIN_REGEX = /^\d{4}$/;
const MODAL_STYLE_ID = "moneyPinModalStyles";

export function validateMoneyPin(pin) {
  return PIN_REGEX.test(String(pin ?? ""));
}

export function hasMoneyPin(profile) {
  const hash = String(profile?.money_pin_hash ?? "").trim();
  const salt = String(profile?.money_pin_salt ?? "").trim();
  return Boolean(hash && salt);
}

export function isMoneyProtectionEnabled(profile) {
  return profile?.hide_money === true && hasMoneyPin(profile);
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomHex(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return bytesToHex(arr);
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(String(text ?? ""));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
}

export async function createMoneyPinSecret(pin) {
  const normalizedPin = String(pin ?? "").trim();
  if (!validateMoneyPin(normalizedPin)) {
    throw new Error("PIN-код должен состоять из 4 цифр.");
  }

  const money_pin_salt = randomHex(16);
  const money_pin_hash = await sha256Hex(`${money_pin_salt}:${normalizedPin}`);

  return { money_pin_hash, money_pin_salt };
}

export async function verifyMoneyPin(pin, profile) {
  const normalizedPin = String(pin ?? "").trim();
  if (!validateMoneyPin(normalizedPin)) return false;
  if (!hasMoneyPin(profile)) return false;

  const expectedHash = String(profile.money_pin_hash);
  const salt = String(profile.money_pin_salt);
  const actualHash = await sha256Hex(`${salt}:${normalizedPin}`);

  return actualHash === expectedHash;
}

function ensureModalStyles() {
  if (document.getElementById(MODAL_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = MODAL_STYLE_ID;
  style.textContent = `
    .money-pin-modal-overlay {
      position: fixed;
      inset: 0;
      z-index: 200;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      background: rgba(2, 6, 23, 0.82);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }

    .money-pin-modal {
      width: 100%;
      max-width: 420px;
      border-radius: 24px;
      background: rgba(15, 23, 42, 0.96);
      border: 1px solid rgba(255, 255, 255, 0.10);
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
      padding: 24px;
      color: rgb(241 245 249);
    }

    .money-pin-modal h3 {
      margin: 0;
      font-size: 1.2rem;
      font-weight: 700;
      line-height: 1.35;
    }

    .money-pin-modal p {
      margin: 10px 0 0;
      font-size: 0.92rem;
      line-height: 1.55;
      color: rgba(226, 232, 240, 0.82);
    }

    .money-pin-modal .money-pin-fields {
      display: grid;
      gap: 12px;
      margin-top: 18px;
    }

    .money-pin-modal .money-pin-label {
      display: block;
      font-size: 0.82rem;
      font-weight: 600;
      color: rgba(226, 232, 240, 0.92);
      margin-bottom: 6px;
    }

    .money-pin-modal .money-pin-input {
      width: 100%;
      border-radius: 16px;
      padding: 14px 16px;
      background: rgba(2, 6, 23, 0.72);
      border: 1px solid rgba(255, 255, 255, 0.10);
      color: rgb(248 250 252);
      font-size: 1.05rem;
      letter-spacing: 0.18em;
      text-align: center;
      outline: none;
      transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
    }

    .money-pin-modal .money-pin-input:focus {
      border-color: rgba(129, 140, 248, 0.8);
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.18);
      background: rgba(2, 6, 23, 0.9);
    }

    .money-pin-modal .money-pin-error {
      min-height: 20px;
      margin-top: 12px;
      font-size: 0.82rem;
      color: rgb(254 202 202);
    }

    .money-pin-modal .money-pin-actions {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
      margin-top: 18px;
      flex-wrap: wrap;
    }

    .money-pin-modal .money-pin-btn {
      appearance: none;
      border: none;
      border-radius: 16px;
      padding: 10px 16px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
    }

    .money-pin-modal .money-pin-btn:active {
      transform: scale(0.98);
    }

    .money-pin-modal .money-pin-btn-secondary {
      background: rgba(255, 255, 255, 0.06);
      color: rgb(226 232 240);
      border: 1px solid rgba(255, 255, 255, 0.10);
    }

    .money-pin-modal .money-pin-btn-primary {
      background: linear-gradient(135deg, #6366f1 0%, #7c3aed 100%);
      color: white;
      box-shadow: 0 12px 28px rgba(99, 102, 241, 0.22);
    }
  `;
  document.head.appendChild(style);
}

function sanitizePinInput(value) {
  return String(value ?? "").replace(/\D+/g, "").slice(0, 4);
}

export function setRevealButtonState({
  hidden,
  button,
  textEl,
  iconEl,
  showText = "Показать",
  hideText = "Скрыть",
  showAria = "Показать",
  hideAria = "Скрыть",
}) {
  if (button) {
    button.setAttribute("aria-pressed", String(!hidden));
    button.setAttribute("aria-label", hidden ? showAria : hideAria);
  }
  if (textEl) textEl.textContent = hidden ? showText : hideText;
  if (iconEl) iconEl.innerHTML = hidden ? EYE_ICON : EYE_OFF_ICON;
}

export function requestMoneyPin({
  mode = "verify",
  title = "Введите PIN-код",
  description = "Введите 4-значный PIN-код.",
  confirmText = "Подтвердить",
  cancelText = "Отмена",
  initialError = "",
} = {}) {
  ensureModalStyles();

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "money-pin-modal-overlay";

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const confirmField = mode === "create"
      ? `
        <div>
          <label class="money-pin-label" for="moneyPinConfirmInput">Повторите PIN</label>
          <input id="moneyPinConfirmInput" class="money-pin-input" type="password" inputmode="numeric" maxlength="4" autocomplete="off" />
        </div>
      `
      : "";

    overlay.innerHTML = `
      <div class="money-pin-modal" role="dialog" aria-modal="true" aria-labelledby="moneyPinModalTitle">
        <h3 id="moneyPinModalTitle">${title}</h3>
        <p>${description}</p>

        <div class="money-pin-fields">
          <div>
            <label class="money-pin-label" for="moneyPinInput">${mode === "create" ? "Новый PIN" : "PIN-код"}</label>
            <input id="moneyPinInput" class="money-pin-input" type="password" inputmode="numeric" maxlength="4" autocomplete="off" />
          </div>
          ${confirmField}
        </div>

        <div id="moneyPinError" class="money-pin-error">${initialError}</div>

        <div class="money-pin-actions">
          <button type="button" id="moneyPinCancelBtn" class="money-pin-btn money-pin-btn-secondary">${cancelText}</button>
          <button type="button" id="moneyPinConfirmBtn" class="money-pin-btn money-pin-btn-primary">${confirmText}</button>
        </div>
      </div>
    `;

    const input = overlay.querySelector("#moneyPinInput");
    const confirmInput = overlay.querySelector("#moneyPinConfirmInput");
    const errorEl = overlay.querySelector("#moneyPinError");
    const cancelBtn = overlay.querySelector("#moneyPinCancelBtn");
    const confirmBtn = overlay.querySelector("#moneyPinConfirmBtn");

    function cleanup(result) {
      document.body.style.overflow = previousOverflow;
      overlay.remove();
      resolve(result);
    }

    function showError(message) {
      if (!errorEl) return;
      errorEl.textContent = message || "";
    }

    function handleSubmit() {
      const pin = sanitizePinInput(input?.value);
      const pinConfirm = sanitizePinInput(confirmInput?.value);

      if (!validateMoneyPin(pin)) {
        showError("PIN-код должен состоять из 4 цифр.");
        input?.focus();
        input?.select?.();
        return;
      }

      if (mode === "create" && pin !== pinConfirm) {
        showError("PIN-коды не совпадают.");
        confirmInput?.focus();
        confirmInput?.select?.();
        return;
      }

      cleanup(pin);
    }

    input?.addEventListener("input", () => {
      input.value = sanitizePinInput(input.value);
      showError("");
    });

    confirmInput?.addEventListener("input", () => {
      confirmInput.value = sanitizePinInput(confirmInput.value);
      showError("");
    });

    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && mode === "verify") {
        e.preventDefault();
        handleSubmit();
      }
    });

    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && mode === "create") {
        e.preventDefault();
        confirmInput?.focus();
      }
    });

    confirmInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    });

    cancelBtn?.addEventListener("click", () => cleanup(null));
    confirmBtn?.addEventListener("click", handleSubmit);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) cleanup(null);
    });

    window.addEventListener(
      "keydown",
      function onEscape(e) {
        if (e.key !== "Escape") return;
        window.removeEventListener("keydown", onEscape);
        cleanup(null);
      },
      { once: true }
    );

    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      input?.focus();
      input?.select?.();
    });
  });
}

export async function requestVerifiedMoneyPin(profile, options = {}) {
  if (!isMoneyProtectionEnabled(profile)) return true;

  let errorMessage = "";

  while (true) {
    const pin = await requestMoneyPin({
      mode: "verify",
      title: options.title || "Введите PIN-код",
      description:
        options.description ||
        "Чтобы показать скрытые данные, введите 4-значный PIN-код.",
      confirmText: options.confirmText || "Показать",
      cancelText: options.cancelText || "Отмена",
      initialError: errorMessage,
    });

    if (pin == null) return false;

    const ok = await verifyMoneyPin(pin, profile);
    if (ok) return true;

    errorMessage = "Неверный PIN-код. Попробуйте ещё раз.";
  }
}

export function createMoneyAccessGuard(profile, options = {}) {
  let unlocked = !isMoneyProtectionEnabled(profile);

  return async function ensureMoneyAccess() {
    if (unlocked) return true;

    const ok = await requestVerifiedMoneyPin(profile, options);
    if (ok) unlocked = true;
    return ok;
  };
}
