export function isNativeApp(capacitor = globalThis.Capacitor) {
  try {
    if (typeof capacitor?.isNativePlatform === "function") {
      return capacitor.isNativePlatform();
    }

    if (typeof capacitor?.getPlatform === "function") {
      return capacitor.getPlatform() !== "web";
    }
  } catch {
    return false;
  }

  return false;
}
