const REQUIRED_PROFILE_FIELDS = Object.freeze([
  ["display_name", "имя"],
  ["position", "должность"],
  ["gender", "пол"],
  ["oklad", "оклад"],
]);

const FIELD_LABEL_BY_KEY = Object.fromEntries(REQUIRED_PROFILE_FIELDS);

export function getMissingRequiredProfileFields(profile) {
  const missing = [];

  const displayName = String(profile?.display_name ?? "").trim();
  if (displayName.length < 2) missing.push("display_name");

  const position = String(profile?.position ?? "").trim();
  if (!position) missing.push("position");

  const gender = String(profile?.gender ?? "").trim();
  if (gender !== "male" && gender !== "female") missing.push("gender");

  const oklad = Number(profile?.oklad);
  if (!(Number.isFinite(oklad) && oklad > 0)) missing.push("oklad");

  return missing;
}

export function getMissingRequiredProfileLabels(profile) {
  return getMissingRequiredProfileFields(profile).map((key) => FIELD_LABEL_BY_KEY[key] ?? key);
}

export function isProfileCompleteForTimesheet(profile) {
  return getMissingRequiredProfileFields(profile).length === 0;
}

export function normalizeInternalNextUrl(nextUrl, fallback = "table.html") {
  const safeFallback = String(fallback || "").trim() || "table.html";
  const raw = String(nextUrl || "").trim();
  if (!raw) return safeFallback;

  try {
    const url = new URL(raw, location.href);
    if (url.origin !== location.origin) return safeFallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return safeFallback;
  }
}

export function buildProfileCompletionUrl(nextUrl, missingKeys = []) {
  const url = new URL("./profile.html", location.href);
  url.searchParams.set("completeProfile", "1");

  const safeNext = normalizeInternalNextUrl(nextUrl, "table.html");
  if (safeNext) url.searchParams.set("next", safeNext);

  const keys = Array.isArray(missingKeys)
    ? missingKeys.map((key) => String(key).trim()).filter(Boolean)
    : [];
  if (keys.length) url.searchParams.set("missing", keys.join(","));

  return url.toString();
}
