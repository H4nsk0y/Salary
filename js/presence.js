import { upsertMyPresence } from "./db.js";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

export function startPresenceHeartbeat(pageName, options = {}) {
  const intervalMs = Number.isFinite(options.intervalMs)
    ? Math.max(10_000, Number(options.intervalMs))
    : DEFAULT_HEARTBEAT_INTERVAL_MS;

  let timerId = null;
  let stopped = false;
  let inFlight = false;
  let hasLoggedFailure = false;

  const ping = async () => {
    if (stopped || inFlight) return;

    inFlight = true;
    try {
      await upsertMyPresence(pageName);
    } catch (error) {
      if (error?.message !== "NO_SESSION" && !hasLoggedFailure) {
        console.warn("Presence heartbeat failed:", error);
        hasLoggedFailure = true;
      }
    } finally {
      inFlight = false;
    }
  };

  const pingOnVisible = () => {
    if (document.visibilityState === "visible") {
      void ping();
    }
  };

  void ping();
  timerId = window.setInterval(() => void ping(), intervalMs);
  document.addEventListener("visibilitychange", pingOnVisible);
  window.addEventListener("focus", pingOnVisible);

  return () => {
    stopped = true;
    if (timerId) window.clearInterval(timerId);
    document.removeEventListener("visibilitychange", pingOnVisible);
    window.removeEventListener("focus", pingOnVisible);
  };
}
