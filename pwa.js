const PWA_STATE_EVENT = "alvisa:pwa-state";
const UPDATE_BANNER_ID = "alvisaPwaUpdateBanner";
const UPDATE_STYLE_ID = "alvisaPwaUpdateStyles";

let deferredInstallPrompt = null;
let registration = null;
let reloadAfterControllerChange = false;

function isLocalhost() {
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function isIosDevice() {
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  return /iPad|iPhone|iPod/i.test(ua) ||
    (platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isPwaInstalled() {
  return Boolean(
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
      window.navigator.standalone === true
  );
}

function isSecurePwaContext() {
  return window.isSecureContext || isLocalhost();
}

export function getPwaState() {
  const supported = "serviceWorker" in navigator && isSecurePwaContext();
  const installed = isPwaInstalled();
  const ios = isIosDevice();
  const updateAvailable = Boolean(registration?.waiting);

  return {
    supported,
    installed,
    ios,
    canPromptInstall: Boolean(deferredInstallPrompt) && !installed,
    updateAvailable,
    reason: !isSecurePwaContext()
      ? "Для установки требуется защищенное HTTPS-соединение."
      : !("serviceWorker" in navigator)
        ? "Этот браузер не поддерживает установку веб-приложений."
        : "",
  };
}

function emitState() {
  window.dispatchEvent(new CustomEvent(PWA_STATE_EVENT, { detail: getPwaState() }));
}

function injectUpdateStyles() {
  if (document.getElementById(UPDATE_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = UPDATE_STYLE_ID;
  style.textContent = `
    .alvisa-pwa-update {
      position: fixed;
      left: 50%;
      bottom: calc(18px + env(safe-area-inset-bottom, 0px));
      z-index: 90;
      width: min(430px, calc(100vw - 24px));
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 14px 14px 16px;
      transform: translateX(-50%);
      border: 1px solid rgba(198, 161, 91, 0.28);
      border-radius: 8px;
      background: rgba(21, 25, 29, 0.97);
      color: #f1eee8;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.42);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .alvisa-pwa-update-copy { min-width: 0; }
    .alvisa-pwa-update-title { font-size: 14px; font-weight: 800; }
    .alvisa-pwa-update-text { margin-top: 3px; color: #aaa59d; font-size: 12px; line-height: 1.4; }
    .alvisa-pwa-update-button {
      flex: 0 0 auto;
      min-height: 38px;
      padding: 0 14px;
      border: 0;
      border-radius: 6px;
      background: #7a1638;
      color: #fff7f8;
      font: inherit;
      font-size: 13px;
      font-weight: 800;
      cursor: pointer;
    }
    .alvisa-pwa-update-button:active { transform: scale(0.98); }
  `;
  document.head.appendChild(style);
}

function showUpdateBanner() {
  if (!registration?.waiting || document.getElementById(UPDATE_BANNER_ID)) return;

  injectUpdateStyles();

  const banner = document.createElement("section");
  banner.id = UPDATE_BANNER_ID;
  banner.className = "alvisa-pwa-update";
  banner.setAttribute("role", "status");

  const copy = document.createElement("div");
  copy.className = "alvisa-pwa-update-copy";

  const title = document.createElement("div");
  title.className = "alvisa-pwa-update-title";
  title.textContent = "Доступно обновление";

  const text = document.createElement("div");
  text.className = "alvisa-pwa-update-text";
  text.textContent = "Новая версия Alvisa уже готова.";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "alvisa-pwa-update-button";
  button.textContent = "Обновить";
  button.addEventListener("click", () => activatePwaUpdate());

  copy.append(title, text);
  banner.append(copy, button);
  document.body.appendChild(banner);
}

function handleWaitingWorker() {
  if (!registration?.waiting) return;
  emitState();
  showUpdateBanner();
}

async function registerPwa() {
  if (!("serviceWorker" in navigator) || !isSecurePwaContext()) {
    emitState();
    return;
  }

  try {
    registration = await navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
    handleWaitingWorker();

    registration.addEventListener("updatefound", () => {
      const worker = registration?.installing;
      if (!worker) return;

      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          handleWaitingWorker();
        }
      });
    });
  } catch (error) {
    console.warn("PWA registration failed", error);
  } finally {
    emitState();
  }
}

export async function requestPwaInstall() {
  const state = getPwaState();

  if (state.installed) {
    return { outcome: "installed", state };
  }

  if (deferredInstallPrompt) {
    const prompt = deferredInstallPrompt;
    deferredInstallPrompt = null;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    emitState();
    return { outcome: choice?.outcome || "dismissed", state: getPwaState() };
  }

  if (state.ios) {
    return { outcome: "ios-help", state };
  }

  return { outcome: state.supported ? "browser-help" : "unsupported", state };
}

export async function checkForPwaUpdate() {
  if (!registration) return getPwaState();

  try {
    await registration.update();
  } catch (error) {
    console.warn("PWA update check failed", error);
  }

  handleWaitingWorker();
  return getPwaState();
}

export function activatePwaUpdate() {
  if (!registration?.waiting) return false;
  reloadAfterControllerChange = true;
  registration.waiting.postMessage({ type: "SKIP_WAITING" });
  return true;
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  emitState();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  emitState();
});

navigator.serviceWorker?.addEventListener("controllerchange", () => {
  if (!reloadAfterControllerChange) return;
  reloadAfterControllerChange = false;
  window.location.reload();
});

void registerPwa();
