export const DEPARTMENT_CHECKLIST_TEMPLATES = Object.freeze({
  egais: Object.freeze([
    "Проверить суточные на отправку",
    "Проверить суточные на правильность",
    "Покрутить марку сменщику",
    "Контролировать розлив",
    "Зафиксировать производство",
    "Отгрузить машины",
    "Принять машины",
    "Отгрузить дистиллят",
    "Принять дистиллят",
  ]),
});

export const EGAIS_REQUIRED_CHECKLIST_ITEM = "Покрутить марку сменщику";

const EGAIS_REQUIRED_CHECKLIST_ALIASES = new Set([
  EGAIS_REQUIRED_CHECKLIST_ITEM.toLocaleLowerCase("ru-RU"),
  "Покрутить марку для сменщика".toLocaleLowerCase("ru-RU"),
]);

export const DEPARTMENT_NAMES = Object.freeze({
  administration: "Администрация",
  accounting: "Бухгалтерия",
  laboratory: "Лаборатория",
  egais: "Отдел ЕГАИС",
  operations: "Отдел эксплуатации",
  warehouse: "Склад ГП",
  hr: "Служба персонала",
  technology: "Технологический отдел",
  bottling: "Цех розлива",
});

function fallbackId() {
  return `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createChecklistItem(text, source = "custom") {
  const normalizedText = String(text ?? "").trim().replace(/\s+/g, " ").slice(0, 160);
  if (!normalizedText) return null;

  return {
    id: globalThis.crypto?.randomUUID?.() ?? fallbackId(),
    text: normalizedText,
    done: false,
    source: source === "standard" ? "standard" : "custom",
  };
}

export function normalizeChecklistItems(items, limit = 40) {
  const result = [];
  const seenIds = new Set();

  for (const raw of Array.isArray(items) ? items : []) {
    const item = createChecklistItem(raw?.text, raw?.source);
    if (!item) continue;

    const requestedId = String(raw?.id ?? "").trim().slice(0, 100);
    item.id = requestedId && !seenIds.has(requestedId) ? requestedId : item.id;
    item.done = raw?.done === true;
    seenIds.add(item.id);
    result.push(item);
    if (result.length >= limit) break;
  }

  return result;
}

export function isRequiredChecklistItem(item, departmentKey) {
  if (String(departmentKey ?? "").trim() !== "egais") return false;
  const text = typeof item === "string" ? item : item?.text;
  return EGAIS_REQUIRED_CHECKLIST_ALIASES.has(
    String(text ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU")
  );
}

export function ensureRequiredChecklistItems(items, departmentKey) {
  const normalized = normalizeChecklistItems(items);
  if (String(departmentKey ?? "").trim() !== "egais") return normalized;

  const required = normalized.find((item) => isRequiredChecklistItem(item, departmentKey));
  const remaining = normalized.filter((item) => !isRequiredChecklistItem(item, departmentKey));
  const canonical = required
    ? { ...required, text: EGAIS_REQUIRED_CHECKLIST_ITEM, source: "standard" }
    : createChecklistItem(EGAIS_REQUIRED_CHECKLIST_ITEM, "standard");

  return canonical ? [canonical, ...remaining].slice(0, 40) : remaining;
}

export function getDepartmentChecklistTemplates(departmentKey) {
  return [...(DEPARTMENT_CHECKLIST_TEMPLATES[String(departmentKey ?? "").trim()] ?? [])];
}

export function checklistProgress(items) {
  const normalized = normalizeChecklistItems(items);
  const total = normalized.length;
  const completed = normalized.filter((item) => item.done).length;
  return {
    total,
    completed,
    remaining: total - completed,
    percent: total ? Math.round((completed / total) * 100) : 0,
  };
}
