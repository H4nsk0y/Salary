const DRIVER_STYLE_URL = "https://unpkg.com/driver.js@0.9.8/dist/driver.min.css";
const DRIVER_SCRIPT_URL = "https://unpkg.com/driver.js@0.9.8/dist/driver.min.js";
const TOUR_STYLE_URL = "./styles/tour.css?v=20260920-1";

function loadStyle(id, href) {
  const existing = document.getElementById(id);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = href;
    link.addEventListener("load", () => resolve(link), { once: true });
    link.addEventListener("error", () => reject(new Error(`Не удалось загрузить стили: ${href}`)), { once: true });
    document.head.appendChild(link);
  });
}

function loadScript(id, src) {
  const existing = document.getElementById(id);
  if (existing) {
    if (window.Driver) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(existing), { once: true });
      existing.addEventListener("error", reject, { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.crossOrigin = "anonymous";
    script.addEventListener("load", () => resolve(script), { once: true });
    script.addEventListener("error", () => reject(new Error("Не удалось загрузить библиотеку обучения.")), { once: true });
    document.head.appendChild(script);
  });
}

function waitForElement(selector, timeoutMs = 10000) {
  if (!selector || document.querySelector(selector)) return Promise.resolve();

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (document.querySelector(selector) || Date.now() - startedAt >= timeoutMs) {
        window.clearInterval(timer);
        resolve();
      }
    }, 100);
  });
}

export async function startRequestedTour(pageName, readySelector = "") {
  const url = new URL(window.location.href);
  if (url.searchParams.get("tour") !== pageName) return false;

  url.searchParams.delete("tour");
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);

  await Promise.all([
    loadStyle("alvisa-driver-style", DRIVER_STYLE_URL),
    loadStyle("alvisa-tour-style", TOUR_STYLE_URL),
    loadScript("alvisa-driver-script", DRIVER_SCRIPT_URL),
    waitForElement(readySelector),
  ]);

  const { startTour } = await import("../tour.js?v=20260920-1");
  startTour(pageName);
  return true;
}

const pageName = document.body?.dataset.tourPage;
if (pageName) {
  startRequestedTour(pageName, document.body.dataset.tourReady || "").catch((error) => {
    console.error("Не удалось запустить обучение:", error);
  });
}
