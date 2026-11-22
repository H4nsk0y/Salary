export const FESTIVE_START = Date.parse("2026-12-20T00:00:00+03:00");
export const FESTIVE_END = Date.parse("2027-01-11T00:00:00+03:00");

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

if (typeof document !== "undefined") {
  let remembered = false;
  try { remembered = sessionStorage.getItem("alvisa.festive.preview") === "1"; } catch { /* Optional local preview. */ }
  const preview = isLocalFestivePreview(location.href, remembered);
  try { sessionStorage.setItem("alvisa.festive.preview", preview ? "1" : "0"); } catch { /* Optional local preview. */ }
  const isActive = () => preview || isFestiveSeason();
  let dispose = null;
  let loading = false;
  async function refresh() {
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
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refresh, { once: true });
  } else void refresh();
  let timer = setInterval(refresh, 60_000);
  window.addEventListener("pagehide", () => {
    clearInterval(timer);
    dispose?.();
    dispose = null;
  });
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    timer = setInterval(refresh, 60_000);
    void refresh();
  });
}
