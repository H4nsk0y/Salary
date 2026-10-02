const LOADER_ID = "alvisaPageLoader";
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

function hydrateLoader(loader) {
  if (loader.querySelector(".alvisa-page-loader-inner")) return loader;
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
  return loader;
}

function createLoader() {
  const loader = document.createElement("div");
  loader.id = LOADER_ID;
  loader.className = "alvisa-page-loader";
  loader.setAttribute("role", "status");
  loader.setAttribute("aria-live", "polite");
  loader.setAttribute("aria-label", "Загрузка данных");
  hydrateLoader(loader);
  (document.body || document.documentElement).appendChild(loader);
  return loader;
}

function ensureLoader() {
  if (!canUseDom() || loaderFinished) return null;
  const loader = hydrateLoader(document.getElementById(LOADER_ID) || createLoader());
  loader.classList.add("is-active");
  return loader;
}

function clearBootSafetyTimer() {
  clearTimeout(window.__alvisaLoaderSafetyTimer);
  window.__alvisaLoaderSafetyTimer = null;
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
      clearBootSafetyTimer();
      setStatus("Не удалось загрузить данные страницы. Проверьте VPN и повторите попытку.");
      loader.classList.add("is-slow");
      return;
    }
    setStatus("Готово");
    setProgress(100);
    setTimeout(() => {
      if (pendingRequests > 0 || loaderFinished) return;
      loaderFinished = true;
      clearBootSafetyTimer();
      loader.classList.add("is-leaving");
      setTimeout(() => {
        document.documentElement.classList.remove("alvisa-loader-primed");
        loader.remove();
      }, 360);
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
