// /storage.js

const STORAGE_KEY = "salary_calc_v2";
// Новый ключ для истории
const HISTORY_KEY = "salary_history";
const MAX_HISTORY = 10; // храним не более 10 записей

/**
 * @returns {Record<string, unknown> | null}
 */
export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, unknown>} state
 */
export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function clearState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ========== НОВЫЙ ФУНКЦИОНАЛ ДЛЯ ИСТОРИИ ==========

/**
 * Загрузить историю расчётов
 * @returns {Array<Object>}
 */
export function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Сохранить историю (внутренняя функция)
 * @param {Array<Object>} history
 */
function saveHistory(history) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    // ignore
  }
}

/**
 * Добавить новый расчёт в историю
 * @param {Object} input - { oklad, normHours, workedHours, nightHours }
 * @param {Object} result - результат расчёта (net, gross, tax)
 */
export function addToHistory(input, result) {
  const history = loadHistory();
  const entry = {
    timestamp: Date.now(),
    input: { ...input },
    result: {
      net: result.net,
      gross: result.gross,
      tax: result.tax,
    },
  };
  history.unshift(entry); // новый в начало
  if (history.length > MAX_HISTORY) {
    history.pop(); // удалить самый старый
  }
  saveHistory(history);
}

/**
 * Очистить всю историю
 */
export function clearHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    // ignore
  }
}