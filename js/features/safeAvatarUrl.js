import { SUPABASE_URL } from "../config.js";

export function safeAvatarUrl(value, userId) {
  const raw = String(value ?? "").trim();
  if (!raw || !/^[0-9a-f-]{36}$/i.test(String(userId))) return "";
  try {
    const storage = new URL(SUPABASE_URL);
    const url = raw.startsWith(`${userId}/`)
      ? new URL(`/storage/v1/object/public/avatars/${raw}`, storage)
      : new URL(raw);
    if (url.protocol !== "https:" || url.origin !== storage.origin || url.username || url.password) return "";
    const path = decodeURIComponent(url.pathname);
    if (!path.startsWith(`/storage/v1/object/public/avatars/${userId}/`)
      && !path.startsWith(`/storage/v1/object/sign/avatars/${userId}/`)) return "";
    if (path.includes("\\") || path.includes("%") || path.split("/").some((segment) => segment === ".." || segment === ".")) return "";
    return url.href;
  } catch {
    return "";
  }
}
