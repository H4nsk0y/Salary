import { requireSession, signOut } from "./auth.js";
import {
  getMyProfile,
  listAllDepartments,
  ownerListClientErrors,
  ownerListPayrollAnalytics,
} from "./db.js";
import { startPresenceHeartbeat } from "./presence.js";
import { setUiStatus } from "./uiStatus.js";

document.body.classList.add("is-loaded");

const logoutBtn = document.getElementById("logoutBtn");
const refreshBtn = document.getElementById("refreshBtn");
const resetFiltersBtn = document.getElementById("resetFiltersBtn");
const statusPill = document.getElementById("statusPill");
const updatedAtPill = document.getElementById("updatedAtPill");
const errorBox = document.getElementById("errorBox");

const yearFilter = document.getElementById("yearFilter");
const departmentFilter = document.getElementById("departmentFilter");
const monthFilter = document.getElementById("monthFilter");
const metricSelect = document.getElementById("metricSelect");
const featureFilter = document.getElementById("featureFilter");
const searchInput = document.getElementById("searchInput");
const filterHint = document.getElementById("filterHint");

const rowsCount = document.getElementById("rowsCount");
const avgDiff = document.getElementById("avgDiff");
const avgDiffHint = document.getElementById("avgDiffHint");
const avgPercent = document.getElementById("avgPercent");
const largeDiffCount = document.getElementById("largeDiffCount");
const totalAbsDiff = document.getElementById("totalAbsDiff");

const insightAccuracy = document.getElementById("insightAccuracy");
const insightFeature = document.getElementById("insightFeature");
const insightGroup = document.getElementById("insightGroup");

const tableCount = document.getElementById("tableCount");
const analyticsBody = document.getElementById("analyticsBody");
const emptyState = document.getElementById("emptyState");
const clientErrorsCount = document.getElementById("clientErrorsCount");
const clientErrorsList = document.getElementById("clientErrorsList");
const clientErrorsEmpty = document.getElementById("clientErrorsEmpty");

const MONTHS = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

const METRICS = {
  net: {
    label: "итогу за месяц",
    shortLabel: "Итог",
    autoKey: "calculated_net",
    actualKey: "actual_net",
    diffKey: "net_diff",
    percentKey: "net_diff_percent",
  },
  advance: {
    label: "авансу",
    shortLabel: "Аванс",
    autoKey: "calculated_advance",
    actualKey: "actual_advance",
    diffKey: "advance_diff",
    percentKey: "advance_diff_percent",
  },
  remaining: {
    label: "остатку",
    shortLabel: "Остаток",
    autoKey: "calculated_remaining",
    actualKey: "actual_remaining",
    diffKey: "remaining_diff",
    percentKey: "remaining_diff_percent",
  },
};

let departments = [];
let rows = [];
let filteredRows = [];
let isLoading = false;
let clientErrors = [];

function renderClientErrors() {
  if (!clientErrorsList) return;
  clientErrorsList.replaceChildren();
  if (clientErrorsCount) clientErrorsCount.textContent = `${clientErrors.length} последних`;
  clientErrorsEmpty?.classList.toggle("hidden", clientErrors.length > 0);

  for (const row of clientErrors) {
    const item = document.createElement("article");
    item.className = "rounded-xl border border-white/10 bg-black/15 p-4";

    const head = document.createElement("div");
    head.className = "flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between";
    head.append(
      text(row.display_name || "Сотрудник", "text-sm font-semibold text-slate-100"),
      text(formatDateTime(row.created_at), "text-xs text-slate-500")
    );

    const message = text(row.message || "Неизвестная ошибка", "mt-2 break-words text-sm text-rose-200");
    const page = text(row.page || "Страница не определена", "mt-2 break-all text-xs text-slate-500");
    item.append(head, message, page);
    clientErrorsList.append(item);
  }
}

function setStatus(text, tone = "neutral") {
  setUiStatus(statusPill, text, tone, { accent: "ring" });
}

function setError(msg) {
  if (!errorBox) return;

  if (!msg) {
    errorBox.classList.add("hidden");
    errorBox.textContent = "";
    return;
  }

  errorBox.classList.remove("hidden");
  errorBox.textContent = msg;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function average(values) {
  const nums = values.map(toNumber).filter((x) => x !== null);
  if (!nums.length) return null;
  return nums.reduce((sum, x) => sum + x, 0) / nums.length;
}

function sum(values) {
  return values
    .map(toNumber)
    .filter((x) => x !== null)
    .reduce((total, x) => total + x, 0);
}

function formatRub(value) {
  const n = toNumber(value);
  if (n === null) return "—";

  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 0,
  }).format(n) + " ₽";
}

function formatSignedRub(value) {
  const n = toNumber(value);
  if (n === null) return "—";

  const sign = n > 0 ? "+" : "";
  return `${sign}${formatRub(n)}`;
}

function formatPercent(value) {
  const n = toNumber(value);
  if (n === null) return "—";

  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2).replace(".", ",")} %`;
}

function formatHours(value) {
  const n = toNumber(value);
  if (n === null) return "—";
  return `${n.toFixed(1).replace(".", ",")} ч`;
}

function formatMonth(row) {
  const monthIndex = Number(row?.month);
  const monthName = MONTHS[monthIndex] || "Месяц";
  return `${monthName} ${row?.year ?? ""}`.trim();
}

function formatDateTime(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getDisplayName(row) {
  return (
    String(row?.display_name ?? "").trim() ||
    String(row?.position ?? "").trim() ||
    `Сотрудник ${String(row?.user_id ?? "").slice(0, 8)}`
  );
}

function getMetric() {
  return METRICS[metricSelect?.value] || METRICS.net;
}

function getMetricDiff(row, metric = getMetric()) {
  return toNumber(row?.[metric.diffKey]);
}

function getMetricPercent(row, metric = getMetric()) {
  return toNumber(row?.[metric.percentKey]);
}

function hasMetric(row, metric = getMetric()) {
  return getMetricDiff(row, metric) !== null;
}

function isLargeDiff(row, metric = getMetric()) {
  const diff = Math.abs(getMetricDiff(row, metric) ?? 0);
  const percent = Math.abs(getMetricPercent(row, metric) ?? 0);
  return diff >= 2000 || percent >= 5;
}

function hasHoliday(row) {
  return (toNumber(row?.holiday_days) ?? 0) > 0 || (toNumber(row?.holiday_hours) ?? 0) > 0;
}

function hasNight(row) {
  return (toNumber(row?.worked_night_hours) ?? 0) > 0;
}

function hasLeave(row) {
  return (toNumber(row?.leave_days) ?? 0) > 0 || toNumber(row?.paid_leave_net) !== null;
}

function isChangedAfterConfirm(row) {
  return row?.status === "changed_after_confirm";
}

function createBadge(label, tone = "neutral") {
  const badge = document.createElement("span");
  badge.className = "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1";
  badge.textContent = label;

  if (tone === "ok") {
    badge.classList.add("bg-emerald-500/10", "text-emerald-200", "ring-emerald-400/20");
  } else if (tone === "warn") {
    badge.classList.add("bg-amber-500/10", "text-amber-200", "ring-amber-400/20");
  } else if (tone === "danger") {
    badge.classList.add("bg-rose-500/10", "text-rose-200", "ring-rose-400/20");
  } else if (tone === "sky") {
    badge.classList.add("bg-sky-500/10", "text-sky-200", "ring-sky-400/20");
  } else if (tone === "indigo") {
    badge.classList.add("bg-indigo-500/10", "text-indigo-200", "ring-indigo-400/20");
  } else {
    badge.classList.add("bg-white/5", "text-slate-300", "ring-white/10");
  }

  return badge;
}

function text(value, className = "") {
  const el = document.createElement("div");
  if (className) el.className = className;
  el.textContent = value;
  return el;
}

function renderYearOptions() {
  if (!yearFilter) return;

  const selected = new URLSearchParams(window.location.search).get("year");
  const currentYear = new Date().getFullYear();
  yearFilter.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "Все годы";
  yearFilter.appendChild(allOption);

  for (let year = currentYear + 1; year >= currentYear - 5; year -= 1) {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    yearFilter.appendChild(option);
  }

  yearFilter.value = selected || String(currentYear);
}

function renderMonthOptions() {
  if (!monthFilter) return;

  const selected = monthFilter.value;
  monthFilter.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "Все месяцы";
  monthFilter.appendChild(allOption);

  MONTHS.forEach((month, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = month;
    monthFilter.appendChild(option);
  });

  monthFilter.value = selected;
}

function renderDepartmentOptions() {
  if (!departmentFilter) return;

  const params = new URLSearchParams(window.location.search);
  const selected = params.get("department") || departmentFilter.value;

  departmentFilter.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "Все отделы";
  departmentFilter.appendChild(allOption);

  for (const department of departments) {
    const option = document.createElement("option");
    option.value = department.key;
    option.textContent = department.name || department.key;
    departmentFilter.appendChild(option);
  }

  departmentFilter.value = selected;
}

function syncUrl() {
  const url = new URL(window.location.href);
  const year = String(yearFilter?.value || "").trim();
  const department = String(departmentFilter?.value || "").trim();

  if (year) url.searchParams.set("year", year);
  else url.searchParams.delete("year");

  if (department) url.searchParams.set("department", department);
  else url.searchParams.delete("department");

  window.history.replaceState({}, "", url);
}

function getSearchBlob(row) {
  return [
    row?.user_id,
    row?.display_name,
    row?.position,
    row?.tab_number,
    row?.department_key,
    row?.department_name,
    row?.year,
    MONTHS[Number(row?.month)],
  ]
    .join(" ")
    .toLowerCase();
}

function currentClientFilters() {
  return {
    search: String(searchInput?.value || "").trim().toLowerCase(),
    month: String(monthFilter?.value || ""),
    feature: String(featureFilter?.value || "all"),
    metric: getMetric(),
  };
}

function applyFilters() {
  const filters = currentClientFilters();

  filteredRows = rows.filter((row) => {
    if (filters.month !== "" && String(row?.month) !== filters.month) return false;
    if (filters.search && !getSearchBlob(row).includes(filters.search)) return false;

    if (filters.feature === "large_diff" && !isLargeDiff(row, filters.metric)) return false;
    if (filters.feature === "holiday" && !hasHoliday(row)) return false;
    if (filters.feature === "night" && !hasNight(row)) return false;
    if (filters.feature === "leave" && !hasLeave(row)) return false;
    if (filters.feature === "changed" && !isChangedAfterConfirm(row)) return false;

    return true;
  });
}

function metricRows() {
  const metric = getMetric();
  return filteredRows.filter((row) => hasMetric(row, metric));
}

function setMetricTone(el, value) {
  if (!el) return;

  el.classList.remove("text-slate-100", "text-sky-200", "text-rose-200", "text-amber-200");

  const n = toNumber(value);
  if (n === null || Math.abs(n) < 1) el.classList.add("text-slate-100");
  else if (Math.abs(n) >= 2000) el.classList.add("text-amber-200");
  else if (n < 0) el.classList.add("text-rose-200");
  else el.classList.add("text-sky-200");
}

function updateMetricCards() {
  const metric = getMetric();
  const list = metricRows();
  const diffs = list.map((row) => getMetricDiff(row, metric));
  const percents = list.map((row) => getMetricPercent(row, metric));
  const avg = average(diffs);
  const avgPct = average(percents);
  const largeCount = list.filter((row) => isLargeDiff(row, metric)).length;
  const totalAbs = sum(diffs.map((value) => Math.abs(value ?? 0)));

  if (rowsCount) rowsCount.textContent = String(filteredRows.length);
  if (avgDiff) {
    avgDiff.textContent = formatSignedRub(avg);
    setMetricTone(avgDiff, avg);
  }
  if (avgDiffHint) {
    avgDiffHint.textContent = list.length
      ? `По ${metric.label}, ${list.length} строк`
      : `По ${metric.label} нет сравнимых строк`;
  }
  if (avgPercent) avgPercent.textContent = formatPercent(avgPct);
  if (largeDiffCount) largeDiffCount.textContent = String(largeCount);
  if (totalAbsDiff) totalAbsDiff.textContent = formatRub(totalAbs);
}

function insightShell(title, body, tone = "neutral") {
  const wrap = document.createDocumentFragment();
  const titleEl = document.createElement("div");
  titleEl.className = "text-xs uppercase text-slate-400";
  titleEl.textContent = title;

  const bodyEl = document.createElement("div");
  bodyEl.className = "mt-3 text-lg font-semibold";
  bodyEl.textContent = body;

  if (tone === "ok") bodyEl.classList.add("text-emerald-200");
  else if (tone === "warn") bodyEl.classList.add("text-amber-200");
  else if (tone === "danger") bodyEl.classList.add("text-rose-200");
  else bodyEl.classList.add("text-slate-100");

  wrap.append(titleEl, bodyEl);
  return wrap;
}

function setInsight(el, title, body, hint = "", tone = "neutral") {
  if (!el) return;

  el.innerHTML = "";
  el.appendChild(insightShell(title, body, tone));

  if (hint) {
    const hintEl = document.createElement("p");
    hintEl.className = "mt-3 text-sm leading-6 text-slate-400";
    hintEl.textContent = hint;
    el.appendChild(hintEl);
  }
}

function rowsWithMetric(list, metric = getMetric()) {
  return list.filter((row) => hasMetric(row, metric));
}

function averageAbsDiff(list, metric = getMetric()) {
  const comparable = rowsWithMetric(list, metric);
  if (!comparable.length) return null;
  return average(comparable.map((row) => Math.abs(getMetricDiff(row, metric) ?? 0)));
}

function updateInsights() {
  const metric = getMetric();
  const list = metricRows();

  if (!list.length) {
    setInsight(insightAccuracy, "Точность", "Нет данных", "Нужны подтверждённые фактические суммы по выбранному показателю.");
    setInsight(insightFeature, "Где искать", "Пока нечего сравнить", "После заполнения факта здесь появятся подсказки по праздникам, ночным и отпускам.");
    setInsight(insightGroup, "Группа риска", "Нет группы", "Недостаточно строк для сравнения отделов и должностей.");
    return;
  }

  const accurate = list.filter((row) => {
    const diff = Math.abs(getMetricDiff(row, metric) ?? 0);
    const percent = getMetricPercent(row, metric);
    return diff <= 500 || (percent !== null && Math.abs(percent) <= 2);
  }).length;
  const accuracyPercent = Math.round((accurate / list.length) * 100);
  const accuracyTone = accuracyPercent >= 75 ? "ok" : accuracyPercent >= 50 ? "warn" : "danger";
  setInsight(
    insightAccuracy,
    "Точность",
    `${accuracyPercent}% близко к факту`,
    `${accurate} из ${list.length} строк отличаются не больше чем на 500 ₽ или 2%.`,
    accuracyTone
  );

  const featureGroups = [
    { label: "праздники", rows: filteredRows.filter(hasHoliday) },
    { label: "ночные", rows: filteredRows.filter(hasNight) },
    { label: "отпуска/больничные", rows: filteredRows.filter(hasLeave) },
    { label: "факт + изменения", rows: filteredRows.filter(isChangedAfterConfirm) },
  ]
    .map((group) => ({
      ...group,
      comparableRows: rowsWithMetric(group.rows, metric).length,
      avgAbs: averageAbsDiff(group.rows, metric),
    }))
    .filter((group) => group.avgAbs !== null)
    .sort((a, b) => b.avgAbs - a.avgAbs);

  const topFeature = featureGroups[0];
  if (topFeature) {
    setInsight(
      insightFeature,
      "Где расходится",
      `${topFeature.label}: ${formatRub(topFeature.avgAbs)}`,
      `Средний модуль разницы по ${topFeature.comparableRows} строкам. Это хороший кандидат для ручной проверки формулы.`,
      topFeature.avgAbs >= 2000 ? "warn" : "neutral"
    );
  } else {
    setInsight(insightFeature, "Где расходится", "Явного признака нет", "По выбранным фильтрам нет праздников, ночных, отпусков или изменённых после факта месяцев.");
  }

  const groups = new Map();
  for (const row of list) {
    const key = row.department_name || row.department_key || row.position || "Без отдела";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const topGroup = [...groups.entries()]
    .map(([label, groupRows]) => ({
      label,
      count: groupRows.length,
      avgAbs: average(groupRows.map((row) => Math.abs(getMetricDiff(row, metric) ?? 0))),
    }))
    .filter((group) => group.avgAbs !== null)
    .sort((a, b) => b.avgAbs - a.avgAbs)[0];

  if (topGroup) {
    setInsight(
      insightGroup,
      "Группа риска",
      `${topGroup.label}: ${formatRub(topGroup.avgAbs)}`,
      `Среднее отклонение по ${topGroup.count} строкам. Чем больше строк, тем надёжнее вывод.`,
      topGroup.avgAbs >= 2000 ? "warn" : "neutral"
    );
  } else {
    setInsight(insightGroup, "Группа риска", "Нет группы", "Недостаточно данных для группировки.");
  }
}

function createMoneyCell(value, muted = false) {
  const cell = document.createElement("td");
  cell.className = muted ? "text-slate-400" : "font-semibold text-slate-100";
  cell.textContent = formatRub(value);
  return cell;
}

function createEmployeeCell(row) {
  const cell = document.createElement("td");
  const name = text(getDisplayName(row), "font-semibold text-slate-100");
  const meta = text(
    [row.position, row.tab_number ? `Таб. № ${row.tab_number}` : ""].filter(Boolean).join(" • ") ||
      `ID: ${String(row.user_id || "").slice(0, 8)}`,
    "mt-1 text-xs text-slate-400"
  );

  cell.append(name, meta);
  return cell;
}

function createPeriodCell(row) {
  const cell = document.createElement("td");
  cell.append(
    text(formatMonth(row), "font-medium text-slate-100"),
    text(`Факт: ${formatDateTime(row.confirmed_at)}`, "mt-1 text-xs text-slate-400")
  );
  return cell;
}

function createDepartmentCell(row) {
  const cell = document.createElement("td");
  cell.append(
    createBadge(row.department_name || row.department_key || "Без отдела", row.department_key ? "sky" : "neutral")
  );
  return cell;
}

function createDiffCell(row, metric) {
  const cell = document.createElement("td");
  const diff = getMetricDiff(row, metric);
  const percent = getMetricPercent(row, metric);
  const value = text(formatSignedRub(diff), "font-bold");

  if (diff === null || Math.abs(diff) < 1) value.classList.add("text-slate-200");
  else if (Math.abs(diff) >= 2000) value.classList.add("text-amber-200");
  else if (diff < 0) value.classList.add("text-rose-200");
  else value.classList.add("text-sky-200");

  const hint = text(formatPercent(percent), "mt-1 text-xs text-slate-400");
  cell.append(value, hint);
  return cell;
}

function createFeatureCell(row) {
  const cell = document.createElement("td");
  const badges = document.createElement("div");
  badges.className = "flex flex-wrap gap-2";

  if (hasHoliday(row)) {
    badges.appendChild(createBadge(`Праздники ${formatHours(row.holiday_hours)}`, "warn"));
  }
  if (hasNight(row)) {
    badges.appendChild(createBadge(`Ночные ${formatHours(row.worked_night_hours)}`, "indigo"));
  }
  if (hasLeave(row)) {
    badges.appendChild(createBadge(`Отпуска/Б ${row.leave_days || 0}`, "sky"));
  }
  if (isChangedAfterConfirm(row)) {
    badges.appendChild(createBadge("Факт + изменения", "danger"));
  }
  if (!badges.children.length) {
    badges.appendChild(createBadge("Обычный месяц"));
  }

  const extra = text(
    `Часы: ${formatHours(row.worked_hours)} · Норма: ${formatHours(row.personal_norm ?? row.month_norm)}`,
    "mt-2 text-xs text-slate-400"
  );

  cell.append(badges, extra);
  return cell;
}

function renderTable() {
  const metric = getMetric();
  const sorted = [...filteredRows].sort((a, b) => {
    const aDiff = Math.abs(getMetricDiff(a, metric) ?? 0);
    const bDiff = Math.abs(getMetricDiff(b, metric) ?? 0);

    return (
      bDiff - aDiff ||
      Number(b.year ?? 0) - Number(a.year ?? 0) ||
      Number(b.month ?? 0) - Number(a.month ?? 0) ||
      getDisplayName(a).localeCompare(getDisplayName(b), "ru-RU")
    );
  });

  if (analyticsBody) analyticsBody.innerHTML = "";

  if (!sorted.length) {
    emptyState?.classList.remove("hidden");
  } else {
    emptyState?.classList.add("hidden");
  }

  if (tableCount) {
    const comparable = sorted.filter((row) => hasMetric(row, metric)).length;
    tableCount.textContent = `Показано ${sorted.length} строк, сравнимых по показателю: ${comparable}`;
  }

  const fragment = document.createDocumentFragment();
  for (const row of sorted) {
    const tr = document.createElement("tr");
    tr.className = "transition-colors hover:bg-white/[0.03]";
    tr.append(
      createEmployeeCell(row),
      createPeriodCell(row),
      createDepartmentCell(row),
      createMoneyCell(row[metric.autoKey], true),
      createMoneyCell(row[metric.actualKey]),
      createDiffCell(row, metric),
      createFeatureCell(row)
    );
    fragment.appendChild(tr);
  }

  analyticsBody?.appendChild(fragment);
}

function updateFilterHint() {
  if (!filterHint) return;

  const total = rows.length;
  const shown = filteredRows.length;
  const metric = getMetric();
  const comparable = filteredRows.filter((row) => hasMetric(row, metric)).length;

  filterHint.textContent = total
    ? `Показано ${shown} из ${total}. Сравнимых по выбранному показателю: ${comparable}.`
    : "Данные пока не загружены.";
}

function renderAll() {
  applyFilters();
  updateMetricCards();
  updateInsights();
  updateFilterHint();
  renderTable();
}

function mapError(error) {
  const message = String(error?.message || "");

  if (message.includes("NO_SESSION")) return "Сессия истекла. Войдите заново.";
  if (message.includes("ACCESS_DENIED")) return "Эта страница доступна только овнеру.";
  if (message.includes("owner_list_payroll_analytics")) {
    return "В базе ещё нет RPC для аналитики выплат. Запустите SQL из supabase-sql/003_owner_payroll_analytics.sql.";
  }

  return message || "Не удалось загрузить аналитику выплат.";
}

async function loadAnalytics(options = {}) {
  if (isLoading) return;

  isLoading = true;
  if (refreshBtn) refreshBtn.disabled = true;

  try {
    if (!options.silent) {
      setStatus("Загружаю аналитику…", "busy");
      setError(null);
    }

    syncUrl();
    [rows, clientErrors] = await Promise.all([
      ownerListPayrollAnalytics({
        year: yearFilter?.value || null,
        departmentKey: departmentFilter?.value || null,
      }),
      ownerListClientErrors(20).catch(() => []),
    ]);

    renderAll();
    renderClientErrors();

    const now = new Date();
    if (updatedAtPill) {
      updatedAtPill.textContent = `Обновлено: ${now.toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    }

    if (!options.silent) setStatus("Готово", "ok");
  } catch (error) {
    setStatus("Ошибка загрузки", "err");
    setError(mapError(error));
  } finally {
    isLoading = false;
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

function bindEvents() {
  logoutBtn?.addEventListener("click", async () => {
    try {
      await signOut();
    } finally {
      location.href = "login.html?next=owner-analytics.html";
    }
  });

  refreshBtn?.addEventListener("click", () => void loadAnalytics());

  resetFiltersBtn?.addEventListener("click", () => {
    const currentYear = new Date().getFullYear();
    if (yearFilter) yearFilter.value = String(currentYear);
    if (departmentFilter) departmentFilter.value = "";
    if (monthFilter) monthFilter.value = "";
    if (metricSelect) metricSelect.value = "net";
    if (featureFilter) featureFilter.value = "all";
    if (searchInput) searchInput.value = "";
    void loadAnalytics();
  });

  yearFilter?.addEventListener("change", () => void loadAnalytics());
  departmentFilter?.addEventListener("change", () => void loadAnalytics());
  monthFilter?.addEventListener("change", renderAll);
  metricSelect?.addEventListener("change", renderAll);
  featureFilter?.addEventListener("change", renderAll);
  searchInput?.addEventListener("input", renderAll);
}

(async () => {
  try {
    await requireSession();
  } catch {
    location.href = "login.html?next=owner-analytics.html";
    return;
  }

  try {
    setStatus("Проверяю доступ…", "busy");
    setError(null);

    const profile = await getMyProfile();
    if (profile?.role !== "owner") {
      setStatus("Доступ запрещён", "err");
      setError("Эта страница доступна только овнеру.");
      return;
    }

    startPresenceHeartbeat("Owner: аналитика");
    bindEvents();
    renderYearOptions();
    renderMonthOptions();

    setStatus("Загружаю отделы…", "busy");
    departments = await listAllDepartments();
    renderDepartmentOptions();

    await loadAnalytics();
  } catch (error) {
    setStatus("Ошибка загрузки", "err");
    setError(mapError(error));
  }
})();
