const NOTIFICATION_TOASTS_ENABLED_KEY = "alvisa.notificationToastsEnabled.v1";

export function isNotificationToastsEnabled() {
  try {
    return localStorage.getItem(NOTIFICATION_TOASTS_ENABLED_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setNotificationToastsEnabled(enabled) {
  try {
    localStorage.setItem(NOTIFICATION_TOASTS_ENABLED_KEY, enabled ? "true" : "false");
  } catch {
    // Storage can be blocked; keep the default behavior for this browser session.
  }
}
