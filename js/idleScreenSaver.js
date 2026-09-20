const IDLE_DELAY_MS = 10 * 60 * 1000;
let started = false;

export function buildIdleScreenSaverUrl(currentHref) {
  const current = new URL(currentHref);
  const destination = new URL("./screen-saver.html", current);
  destination.searchParams.set("mode", "building");
  destination.searchParams.set("from", `${current.pathname}${current.search}${current.hash}`);
  return destination.href;
}

export function startIdleScreenSaver() {
  if (started || typeof window === "undefined" || !document.querySelector("[data-app-header]")) return;
  started = true;

  let lastActivity = Date.now();
  let timer;
  const schedule = () => {
    clearTimeout(timer);
    if (document.visibilityState !== "visible") return;
    timer = setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      const remaining = IDLE_DELAY_MS - (Date.now() - lastActivity);
      if (remaining > 0) {
        schedule();
        return;
      }
      window.location.assign(buildIdleScreenSaverUrl(window.location.href));
    }, Math.max(0, IDLE_DELAY_MS - (Date.now() - lastActivity)));
  };
  const recordActivity = () => {
    if (document.visibilityState !== "visible") return;
    const now = Date.now();
    if (now - lastActivity < 1000) return;
    lastActivity = now;
    schedule();
  };

  for (const eventName of ["pointermove", "pointerdown", "keydown", "wheel", "scroll", "touchstart"]) {
    window.addEventListener(eventName, recordActivity, { passive: true });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      lastActivity = Date.now();
      schedule();
    } else {
      clearTimeout(timer);
    }
  });
  schedule();
}
