const LOADER_ID = "alvisaPageLoader";
const STYLE_ID = "alvisaPageLoaderStyles";
const SLOW_REQUEST_MS = 8000;
const SETTLE_DELAY_MS = 120;
const INITIAL_PROGRESS = 8;
const REQUEST_PROGRESS_LIMIT = 88;

let pendingRequests = 0;
let startedRequests = 0;
let completedRequests = 0;
let currentProgress = INITIAL_PROGRESS;
let loaderFinished = false;
let initialLoadFailed = false;
let criticalLoadFailed = false;
let settleTimer = null;
let slowTimer = null;

function canUseDom() {
  return typeof document !== "undefined" && Boolean(document.documentElement);
}

function hasPersistedSupabaseSession() {
  try {
    return Object.keys(localStorage).some((key) => /^sb-.+-auth-token$/.test(key));
  } catch {
    return false;
  }
}

function injectStyles() {
  if (!canUseDom() || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .alvisa-page-loader{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:24px;background:#0b0d0f;color:#f1eee8;opacity:1;visibility:visible;transition:opacity .32s ease,visibility .32s ease}
    .alvisa-page-loader.is-leaving{opacity:0;visibility:hidden;pointer-events:none}
    .alvisa-page-loader-inner{width:min(320px,82vw);display:grid;justify-items:center;text-align:center}
    .alvisa-page-loader-icon{width:112px;height:112px;object-fit:cover;border-radius:18px;filter:drop-shadow(0 18px 36px rgba(0,0,0,.48));animation:alvisa-loader-breathe 1.75s ease-in-out infinite}
    .alvisa-page-loader-title{margin-top:22px;font-family:Anticva,Georgia,serif;font-size:1.55rem;font-weight:400}
    .alvisa-page-loader-status{min-height:1.4em;margin-top:8px;color:#9ea3a7;font:500 .76rem/1.5 Inter,system-ui,sans-serif}
    .alvisa-page-loader-progress{display:flex;width:100%;align-items:center;gap:12px;margin-top:20px}
    .alvisa-page-loader-track{position:relative;min-width:0;flex:1;height:3px;overflow:hidden;border-radius:3px;background:rgba(241,238,232,.1)}
    .alvisa-page-loader-bar{position:absolute;inset-block:0;left:0;width:8%;border-radius:inherit;background:linear-gradient(90deg,#7a1638,#c6a15b,#6ea8e8);box-shadow:0 0 16px rgba(198,161,91,.2);transition:width .28s ease}
    .alvisa-page-loader-percent{min-width:3.2em;color:#c8c3bc;font:700 .72rem/1 Inter,system-ui,sans-serif;text-align:right;font-variant-numeric:tabular-nums}
    .alvisa-page-loader-retry{display:none;min-height:40px;margin-top:18px;padding:0 16px;border:1px solid rgba(198,161,91,.42);border-radius:6px;background:rgba(198,161,91,.1);color:#ead3a5;font:700 .76rem Inter,system-ui,sans-serif;cursor:pointer}
    .alvisa-page-loader.is-slow .alvisa-page-loader-retry{display:inline-flex;align-items:center;justify-content:center}
    .alvisa-page-loader-retry:hover{background:rgba(198,161,91,.18)}
    @keyframes alvisa-loader-breathe{0%,100%{transform:scale(.92);opacity:.72}50%{transform:scale(1.06);opacity:1}}
    @media(prefers-reduced-motion:reduce){.alvisa-page-loader-icon{animation:alvisa-loader-fade 1.8s ease-in-out infinite}.alvisa-page-loader-bar{transition:none}@keyframes alvisa-loader-fade{0%,100%{opacity:.45}50%{opacity:1}}}
  `;
  document.head.appendChild(style);
}

function createLoader() {
  injectStyles();
  const loader = document.createElement("div");
  loader.id = LOADER_ID;
  loader.className = "alvisa-page-loader";
  loader.setAttribute("role", "status");
  loader.setAttribute("aria-live", "polite");
  loader.setAttribute("aria-label", "Загрузка данных");
  loader.innerHTML = `
    <div class="alvisa-page-loader-inner">
      <img class="alvisa-page-loader-icon" src="./images/app-icon-512.png" alt="" />
      <div class="alvisa-page-loader-title">ALVISA SALARY</div>
      <div class="alvisa-page-loader-status" data-loader-status>Загружаем данные…</div>
      <div class="alvisa-page-loader-progress">
        <div class="alvisa-page-loader-track" role="progressbar" aria-label="Загрузка данных" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${INITIAL_PROGRESS}">
          <span class="alvisa-page-loader-bar"></span>
        </div>
        <span class="alvisa-page-loader-percent" data-loader-percent>${INITIAL_PROGRESS}%</span>
      </div>
      <button class="alvisa-page-loader-retry" type="button">Обновить страницу</button>
    </div>
  `;
  loader.querySelector(".alvisa-page-loader-retry")?.addEventListener("click", () => location.reload());
  (document.body || document.documentElement).appendChild(loader);
  return loader;
}

function ensureLoader() {
  if (!canUseDom() || loaderFinished) return null;
  return document.getElementById(LOADER_ID) || createLoader();
}

function setStatus(text) {
  const status = ensureLoader()?.querySelector("[data-loader-status]");
  if (status) status.textContent = text;
}

function setProgress(value) {
  if (loaderFinished) return;
  const normalized = Math.max(currentProgress, Math.min(100, Math.round(Number(value) || 0)));
  currentProgress = normalized;
  const loader = ensureLoader();
  const track = loader?.querySelector('[role="progressbar"]');
  const bar = loader?.querySelector(".alvisa-page-loader-bar");
  const percent = loader?.querySelector("[data-loader-percent]");
  if (track) {
    track.setAttribute("aria-valuenow", String(normalized));
    track.setAttribute("aria-valuetext", `${normalized}%`);
  }
  if (bar) bar.style.width = `${normalized}%`;
  if (percent) percent.textContent = `${normalized}%`;
}

function updateRequestProgress() {
  if (startedRequests < 1) {
    setProgress(INITIAL_PROGRESS);
    return;
  }
  const ratio = Math.min(1, completedRequests / startedRequests);
  setProgress(INITIAL_PROGRESS + ratio * (REQUEST_PROGRESS_LIMIT - INITIAL_PROGRESS));
}

function scheduleSlowMessage() {
  clearTimeout(slowTimer);
  slowTimer = setTimeout(() => {
    if (pendingRequests > 0) {
      setStatus("Связь с базой занимает больше времени. Проверьте VPN.");
      document.getElementById(LOADER_ID)?.classList.add("is-slow");
    }
  }, SLOW_REQUEST_MS);
}

function finishLoader() {
  if (loaderFinished || pendingRequests > 0) return;
  clearTimeout(settleTimer);
  setProgress(94);
  setStatus("Применяем данные…");
  settleTimer = setTimeout(() => {
    if (pendingRequests > 0 || loaderFinished) return;
    clearTimeout(slowTimer);
    const loader = document.getElementById(LOADER_ID);
    if (!loader) return;
    if (criticalLoadFailed || initialLoadFailed) {
      setStatus("Не удалось загрузить данные страницы. Проверьте VPN и повторите попытку.");
      loader.classList.add("is-slow");
      return;
    }
    setStatus("Готово");
    setProgress(100);
    setTimeout(() => {
      if (pendingRequests > 0 || loaderFinished) return;
      loaderFinished = true;
      loader.classList.add("is-leaving");
      setTimeout(() => loader.remove(), 360);
    }, 80);
  }, SETTLE_DELAY_MS);
}

export function beginPageDataRequest({
  label = "Загружаем данные…",
  critical = false,
  persistedSessionOnly = false,
} = {}) {
  if (loaderFinished || !canUseDom()) return null;
  if (persistedSessionOnly && !hasPersistedSupabaseSession()) return null;
  clearTimeout(settleTimer);
  pendingRequests += 1;
  startedRequests += 1;
  ensureLoader();
  setStatus(label);
  updateRequestProgress();
  scheduleSlowMessage();
  return { active: true, failed: false, critical: critical === true };
}

export function finishPageDataRequest(token, { failed = false } = {}) {
  if (!token?.active || loaderFinished) return;
  token.active = false;
  token.failed = failed;
  initialLoadFailed ||= failed;
  criticalLoadFailed ||= failed && token.critical === true;
  pendingRequests = Math.max(0, pendingRequests - 1);
  completedRequests += 1;
  updateRequestProgress();
  if (pendingRequests === 0) finishLoader();
}

function sealLoaderAfterInitialBoot() {
  setTimeout(() => {
    if (pendingRequests === 0) finishLoader();
  }, 700);
}

if (typeof window !== "undefined") {
  if (hasPersistedSupabaseSession()) ensureLoader();
  if (document.readyState === "complete") sealLoaderAfterInitialBoot();
  else window.addEventListener("load", sealLoaderAfterInitialBoot, { once: true });
}
