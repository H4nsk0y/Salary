export const FESTIVE_START = Date.parse("2026-12-10T00:00:00+03:00");
export const FESTIVE_END = Date.parse("2027-01-10T00:00:00+03:00");

export function isFestiveSeason(now = Date.now()) {
  return now >= FESTIVE_START && now < FESTIVE_END;
}

export function isLocalFestivePreview(href, remembered = false) {
  try {
    const url = new URL(href);
    if (!["http:", "https:"].includes(url.protocol) ||
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return false;
    return url.searchParams.has("festive-preview")
      ? url.searchParams.get("festive-preview") === "1"
      : remembered;
  } catch { return false; }
}

export function updateFestiveLoader() {
  if (typeof document === "undefined") return;
  let remembered = false;
  try { remembered = sessionStorage.getItem("alvisa.festive.preview") === "1"; } catch { /* Optional local preview. */ }
  const active = isFestiveSeason() || isLocalFestivePreview(location.href, remembered);
  const normal = new URL("../../images/app-icon-512.png", import.meta.url).href;
  const festive = new URL("../../images/festive-loader-v1.webp", import.meta.url).href;
  document.querySelectorAll(".alvisa-page-loader-icon").forEach(image => {
    image.classList.toggle("is-festive", active);
    const source = active ? festive : normal;
    if (image.src !== source) image.src = source;
    if (!image.dataset.themeFallbackBound) {
      image.dataset.themeFallbackBound = "1";
      image.addEventListener("error", () => {
        if (image.src === normal) return;
        image.classList.remove("is-festive");
        image.src = normal;
      });
    }
  });
}

if (typeof document !== "undefined") {
  let remembered = false;
  try { remembered = sessionStorage.getItem("alvisa.festive.preview") === "1"; } catch { /* Optional local preview. */ }
  const preview = isLocalFestivePreview(location.href, remembered);
  try { sessionStorage.setItem("alvisa.festive.preview", preview ? "1" : "0"); } catch { /* Optional local preview. */ }
  const isActive = () => preview || isFestiveSeason();
  let dispose = null;
  let loading = false;
  let boundaryTimer = 0;
  async function refresh() {
    updateFestiveLoader();
    if (!isActive()) {
      dispose?.();
      dispose = null;
      return;
    }
    if (dispose || loading) return;
    loading = true;
    try {
      const { mountFestiveEvent } = await import("./festiveEvent.js");
      if (isActive()) dispose = mountFestiveEvent();
    } catch (error) {
      console.warn("Новогодний режим недоступен:", error);
    } finally {
      loading = false;
    }
  }
  updateFestiveLoader();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refresh, { once: true });
  } else void refresh();
  let timer = setInterval(refresh, 60_000);
  function scheduleBoundary() {
    clearTimeout(boundaryTimer);
    const now = Date.now();
    const next = now < FESTIVE_START ? FESTIVE_START : now < FESTIVE_END ? FESTIVE_END : 0;
    if (next) boundaryTimer = setTimeout(() => {
      void refresh();
      scheduleBoundary();
    }, Math.min(next - now, 2_147_000_000));
  }
  scheduleBoundary();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    scheduleBoundary();
    void refresh();
  });
  window.addEventListener("pagehide", () => {
    clearInterval(timer);
    clearTimeout(boundaryTimer);
    dispose?.();
    dispose = null;
  });
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    timer = setInterval(refresh, 60_000);
    scheduleBoundary();
    void refresh();
  });
}
