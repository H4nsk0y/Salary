export const DEPARTMENT_CHECKLIST_TEMPLATES = Object.freeze({
  egais: Object.freeze([
    "Проверить суточные на отправку",
    "Проверить суточные на правильность",
    "Покрутить марку для сменщика",
    "Контролировать розлив",
    "Зафиксировать производство",
    "Отгрузить машины",
    "Принять машины",
    "Отгрузить дистиллят",
    "Принять дистиллят",
  ]),
});

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
