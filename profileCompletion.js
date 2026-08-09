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
  const appBase = new URL(".", location.href);

  const normalize = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return "";

    try {
      const url = new URL(raw, appBase);
      const allowedProtocol = url.protocol === "https:" || url.protocol === "http:";
      const insideApp = url.pathname.startsWith(appBase.pathname);
      if (!allowedProtocol || url.origin !== appBase.origin || !insideApp) return "";
      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return "";
    }
  };

  const safeFallback = normalize(fallback) || (fallback === "" || fallback == null
    ? ""
    : normalize("table.html"));

  return normalize(nextUrl) || safeFallback;
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
