const STORAGE_KEY = "alvisa.keepScreenAwake.v1";

let wakeLock = null;
let lastError = "";

function readPreference() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writePreference(enabled) {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // The current page can still hold the lock even if private storage is unavailable.
  }
}

function isSupported() {
  return Boolean(navigator?.wakeLock?.request);
}

function emitState() {
  window.dispatchEvent(new CustomEvent("alvisa:screen-wake-state", {
    detail: getScreenWakeState(),
  }));
}

async function requestWakeLock() {
  if (!readPreference() || !isSupported() || document.visibilityState !== "visible") {
    emitState();
    return getScreenWakeState();
  }

  if (wakeLock && !wakeLock.released) return getScreenWakeState();

  try {
    wakeLock = await navigator.wakeLock.request("screen");
    lastError = "";
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
      emitState();
    }, { once: true });
  } catch (error) {
    wakeLock = null;
    lastError = String(error?.message || "Браузер или система отклонили запрос.");
  }

  emitState();
  return getScreenWakeState();
}

export function getScreenWakeState() {
  return {
    supported: isSupported(),
    enabled: readPreference(),
    active: Boolean(wakeLock && !wakeLock.released),
    error: lastError,
  };
}

export async function setScreenWakeEnabled(enabled) {
  writePreference(Boolean(enabled));
  lastError = "";

  if (!enabled) {
    const lock = wakeLock;
    wakeLock = null;
    if (lock && !lock.released) await lock.release();
    emitState();
    return getScreenWakeState();
  }

  return requestWakeLock();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && readPreference()) {
    void requestWakeLock();
  }
});

window.addEventListener("pageshow", () => {
  if (readPreference()) void requestWakeLock();
});

if (readPreference()) void requestWakeLock();
