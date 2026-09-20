export const DEFAULT_DAY_HOURS = 8;
export const FEMALE_DAY_HOURS = 7.2;
export const DEFAULT_WEEKLY_HOURS = 40;
export const REDUCED_WEEKLY_HOURS = 35;
export const CHATEAU_ALVISA_BRANCH = "chateau_alvisa";
export const NOT_EMPLOYED_LEAVE_TYPE = "not_employed";
export const DISMISSED_LEAVE_TYPE = "dismissed";

export function normalizeWeeklyHours(value) {
  const hours = Number(value);
  if (hours === REDUCED_WEEKLY_HOURS) return REDUCED_WEEKLY_HOURS;
  if (hours === DEFAULT_WEEKLY_HOURS) return DEFAULT_WEEKLY_HOURS;
  return null;
}

export function getWeeklyHoursByProfile(profile) {
  return normalizeWeeklyHours(profile?.weekly_hours) ?? DEFAULT_WEEKLY_HOURS;
}

export function getBaseDayHours(gender, branch, weeklyHours = null) {
  if (normalizeWeeklyHours(weeklyHours) === REDUCED_WEEKLY_HOURS) {
    return REDUCED_WEEKLY_HOURS / 5;
  }
  return gender === "female" && branch === CHATEAU_ALVISA_BRANCH
    ? FEMALE_DAY_HOURS
    : DEFAULT_DAY_HOURS;
}

export function getBaseDayHoursByProfile(profile) {
  return getBaseDayHours(profile?.gender, profile?.branch, getWeeklyHoursByProfile(profile));
}

export function normalizeNormSnapshot(raw) {
  if (!raw || typeof raw !== "object") return null;
  const baseDayHours = Number(raw.baseDayHours);
  if (!(Number.isFinite(baseDayHours) && baseDayHours > 0)) return null;
  return {
    weeklyHours: normalizeWeeklyHours(raw.weeklyHours),
    baseDayHours,
    gender: raw.gender ?? null,
    branch: raw.branch ?? null,
  };
}

export function sanitizeDayCellValue(raw) {
  let value = String(raw ?? "").toUpperCase();
  value = value
    .replaceAll("O", "О").replaceAll("T", "Т").replaceAll("B", "Б")
    .replaceAll("D", "Д").replaceAll("Z", "З").replaceAll("U", "У")
    .replaceAll("Y", "У").replaceAll("N", "Н").replaceAll("V", "В")
    .replace(/\s+/g, "");

  const letters = value.replace(/[^ОТБДЗУЛНВ]/g, "");
  if (letters) {
    if (letters.includes("Б")) return "Б";
    if (letters.startsWith("Н")) return "НТ";
    if (letters.startsWith("О")) {
      if (letters[1] === "Т") return "ОТ";
      if (letters[1] === "Д") return "ОД";
      if (letters[1] === "З") return "ОЗ";
      return "О";
    }
    if (letters.startsWith("У")) {
      if (letters[1] === "В") return "УВ";
      if (letters[1] === "Д") return "УД";
      return "У";
    }
    return "";
  }

  return sanitizeNumericValue(value);
}

export function sanitizeNumericValue(raw) {
  let value = String(raw ?? "").trim().replace(/\s+/g, "").replace(/[^0-9.,]/g, "");
  if (!value) return "";
  if (value.includes(".") && value.includes(",")) value = value.replace(/,/g, ".");
  const separatorIndex = value.search(/[.,]/);
  if (separatorIndex !== -1) {
    value = value.slice(0, separatorIndex) + value[separatorIndex]
      + value.slice(separatorIndex + 1).replace(/[.,]/g, "");
  }
  return value;
}

export function normalizeLeaveTypeLegacy(leaveType) {
  if (!leaveType) return null;
  if (leaveType === "vacation") return "vac_paid";
  if (leaveType === "sick") return "sick";
  if (leaveType === NOT_EMPLOYED_LEAVE_TYPE) return NOT_EMPLOYED_LEAVE_TYPE;
  if (leaveType === DISMISSED_LEAVE_TYPE) return DISMISSED_LEAVE_TYPE;
  if (String(leaveType).trim().toUpperCase() === "НТ") return NOT_EMPLOYED_LEAVE_TYPE;
  if (String(leaveType).trim().toUpperCase() === "УВ") return DISMISSED_LEAVE_TYPE;
  return String(leaveType);
}

export function normalizeLeaveToken(raw) {
  const source = String(raw ?? "").trim().toUpperCase();
  if (!source) return null;
  const value = source
    .replaceAll("O", "О").replaceAll("T", "Т").replaceAll("B", "Б")
    .replaceAll("D", "Д").replaceAll("Z", "З").replaceAll("U", "У")
    .replaceAll("Y", "У").replaceAll("L", "Л").replaceAll("N", "Н")
    .replaceAll("V", "В");
  if (value === "О" || value === "ОТ") return "vac_paid";
  if (value === "ОД") return "vac_unpaid";
  if (value === "ОЗ") return "vac_unpaid_required";
  if (value === "Б" || value === "БЛ") return "sick";
  if (value === "У") return "edu_paid";
  if (value === "УД") return "edu_unpaid";
  if (value === "НТ") return NOT_EMPLOYED_LEAVE_TYPE;
  if (value === "УВ") return DISMISSED_LEAVE_TYPE;
  return null;
}

export function leaveTypeToCode(leaveType, raw = "") {
  const normalized = normalizeLeaveTypeLegacy(leaveType);
  if (!normalized) return "";
  if (normalized === "vac_paid") return String(raw ?? "").trim().toUpperCase() === "О" ? "О" : "ОТ";
  if (normalized === "vac_unpaid") return "ОД";
  if (normalized === "vac_unpaid_required") return "ОЗ";
  if (normalized === "edu_paid") return "У";
  if (normalized === "edu_unpaid") return "УД";
  if (normalized === "sick") return "Б";
  if (normalized === NOT_EMPLOYED_LEAVE_TYPE) return "НТ";
  if (normalized === DISMISSED_LEAVE_TYPE) return "УВ";
  return "";
}

export function leaveTypeToLabel(leaveType) {
  const normalized = normalizeLeaveTypeLegacy(leaveType);
  const labels = {
    vac_paid: "Отпуск (ОТ)",
    vac_unpaid: "Отпуск без оплаты (ОД)",
    vac_unpaid_required: "Отпуск без оплаты (ОЗ)",
    edu_paid: "Учебный отпуск (У)",
    edu_unpaid: "Учебный отпуск без оплаты (УД)",
    sick: "Больничный (Б)",
    [NOT_EMPLOYED_LEAVE_TYPE]: "Не трудоустроен (НТ)",
    [DISMISSED_LEAVE_TYPE]: "Увольнение (УВ)",
  };
  return normalized ? labels[normalized] || String(normalized) : "";
}

export function sanitizeLeaveDisplayValue(raw, leaveType) {
  return leaveTypeToCode(leaveType, raw) || String(raw ?? "").trim().toUpperCase();
}

export function sanitizeHourNumber(value) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function formatHourForInput(value) {
  const hours = Number(value);
  if (!Number.isFinite(hours) || Math.abs(hours) < 1e-9) return "";
  return String(hours);
}
