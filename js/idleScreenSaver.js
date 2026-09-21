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
  let lastPointerX = null;
  let lastPointerY = null;
  const recordActivity = (event) => {
    if (document.visibilityState !== "visible") return;
    if (event?.isTrusted === false) return;
    const now = Date.now();
    if (now - lastActivity < 1000) return;
    lastActivity = now;
    schedule();
  };

  const recordPointerActivity = (event) => {
    if (event?.isTrusted === false) return;
    const x = Number(event?.clientX);
    const y = Number(event?.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    if (lastPointerX === null || Math.hypot(x - lastPointerX, y - lastPointerY) >= 8) {
      lastPointerX = x;
      lastPointerY = y;
      recordActivity(event);
    }
  };

  window.addEventListener("pointermove", recordPointerActivity, { passive: true });
  for (const eventName of ["pointerdown", "keydown", "wheel", "touchstart"]) {
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
