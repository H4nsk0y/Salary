export const CUSTOM_POSITION_VALUE = "__custom__";

export function normalizeCustomPosition(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function isValidCustomPosition(value) {
  const normalized = normalizeCustomPosition(value);
  return normalized.length >= 2
    && normalized.length <= 80
    && !/[<>\{\}\u0000-\u001f\u007f]/.test(normalized);
}

export function validateCustomPositionSelection({ department, position, allowedDepartments } = {}) {
  const normalizedDepartment = String(department ?? "").trim();
  const normalizedPosition = normalizeCustomPosition(position);
  const departments = allowedDepartments instanceof Set
    ? allowedDepartments
    : new Set(Array.isArray(allowedDepartments) ? allowedDepartments : []);

  if (!normalizedDepartment || (departments.size && !departments.has(normalizedDepartment))) {
    return { ok: false, field: "department", message: "Сначала выберите отдел." };
  }

  if (!isValidCustomPosition(normalizedPosition)) {
    return {
      ok: false,
      field: "position",
      message: "Введите название должности длиной от 2 до 80 символов без служебных знаков.",
    };
  }

  return {
    ok: true,
    department: normalizedDepartment,
    position: normalizedPosition,
  };
}
