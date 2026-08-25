const CACHE_VERSION = 1;
const CACHE_PREFIX = `alvisa.schedule-cache.v${CACHE_VERSION}`;
const MAX_CACHE_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function userKey(userId) {
  return String(userId || "").trim();
}

function snapshotKey(userId, departmentKey, startDate) {
  return `${CACHE_PREFIX}.snapshot:${userKey(userId)}:${departmentKey}:${startDate}`;
}

function contextKey(userId) {
  return `${CACHE_PREFIX}.context:${userKey(userId)}`;
}

function isFresh(timestamp) {
  const savedAt = new Date(timestamp).getTime();
  return Number.isFinite(savedAt) && Date.now() - savedAt <= MAX_CACHE_AGE_MS;
}

export function saveScheduleContext(userId, departments, selectedDepartmentKey) {
  if (!userKey(userId) || !Array.isArray(departments)) return;

  try {
    localStorage.setItem(contextKey(userId), JSON.stringify({
      savedAt: new Date().toISOString(),
      departments,
      selectedDepartmentKey: String(selectedDepartmentKey || ""),
    }));
  } catch {
    // Private browsing and full storage must not break the schedule.
  }
}

export function loadScheduleContext(userId) {
  if (!userKey(userId)) return null;

  try {
    const cached = safeParse(localStorage.getItem(contextKey(userId)));
    if (!cached || !isFresh(cached.savedAt) || !Array.isArray(cached.departments)) return null;
    return cached;
  } catch {
    return null;
  }
}

export function saveScheduleSnapshot({ userId, departmentKey, startDate, days, rows }) {
  if (!userKey(userId) || !departmentKey || !startDate || !Array.isArray(rows)) return;

  try {
    localStorage.setItem(snapshotKey(userId, departmentKey, startDate), JSON.stringify({
      savedAt: new Date().toISOString(),
      departmentKey,
      startDate,
      days,
      rows,
    }));
  } catch {
    // Cache is an optional fallback and must never block fresh data.
  }
}

export function loadScheduleSnapshot({ userId, departmentKey, startDate, days }) {
  if (!userKey(userId) || !departmentKey || !startDate) return null;

  try {
    const cached = safeParse(localStorage.getItem(snapshotKey(userId, departmentKey, startDate)));
    if (!cached || !isFresh(cached.savedAt) || !Array.isArray(cached.rows)) return null;
    if (Number(cached.days) !== Number(days)) return null;
    return cached;
  } catch {
    return null;
  }
}

