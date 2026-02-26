// /app.js
import { computeSalary, parseNumber, TAX_RATE, NIGHT_EXTRA_RATE } from "./calc.js";
import { clearState, loadState, saveState, addToHistory, loadHistory, clearHistory } from "./storage.js";

document.body.classList.add("is-loaded");

const form = document.getElementById("salaryForm");
const errorBox = document.getElementById("errorBox");
const resetBtn = document.getElementById("resetBtn");

const eggOverlay = document.getElementById("easterEgg");
const eggText = document.getElementById("easterText");

const historySelect = document.getElementById("historySelect");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");

const els = {
  oklad: document.getElementById("oklad"),
  normHours: document.getElementById("normHours"),
  workedHours: document.getElementById("workedHours"),
  nightHours: document.getElementById("nightHours"),

  holidayToggle: document.getElementById("holidayToggle"),
  holidayFields: document.getElementById("holidayFields"),
  holidayShifts: document.getElementById("holidayShifts"),
  holidayNightShifts: document.getElementById("holidayNightShifts"),

  net: document.getElementById("net"),
  summary: document.getElementById("summary"),

  hourRate: document.getElementById("hourRate"),
  baseFact: document.getElementById("baseFact"),
  bonus: document.getElementById("bonus"),
  nightExtra: document.getElementById("nightExtra"),

  advance: document.getElementById("advance"),
  remaining: document.getElementById("remaining"),
};

const prefersReducedMotion =
  window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

let eggActive = false;
let wasAll69 = false;

const HOLIDAY_SHIFT_HOURS = 11;
const HOLIDAY_NIGHT_HOURS_PER_SHIFT = 7;
const HOLIDAY_MULTIPLIER = 2;

function formatRub(value, digits) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: digits,
  }).format(n);
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function bump(el) {
  if (prefersReducedMotion || !el) return;
  el.classList.remove("pop");
  // eslint-disable-next-line no-unused-expressions
  el.offsetWidth;
  el.classList.add("pop");
}

function animateNumber(el, to, formatter, durationMs = 520) {
  if (!el) return;

  if (prefersReducedMotion || !Number.isFinite(to)) {
    el.textContent = formatter(to);
    el.dataset.value = String(to);
    return;
  }

  const from = Number.isFinite(Number(el.dataset.value)) ? Number(el.dataset.value) : 0;
  if (Math.abs(to - from) < 0.01) {
    el.textContent = formatter(to);
    el.dataset.value = String(to);
    return;
  }

  const start = performance.now();

  function tick(now) {
    const t = Math.min(1, (now - start) / durationMs);
    const k = easeOutCubic(t);
    const v = from + (to - from) * k;

    el.textContent = formatter(v);
    if (t < 1) requestAnimationFrame(tick);
    else {
      el.textContent = formatter(to);
      el.dataset.value = String(to);
    }
  }

  requestAnimationFrame(tick);
}

function setError(msg) {
  if (!msg) {
    errorBox.classList.add("hidden");
    errorBox.textContent = "";
    errorBox.classList.remove("shake");
    return;
  }
  errorBox.classList.remove("hidden");
  errorBox.textContent = msg;
  errorBox.classList.remove("shake");
  // eslint-disable-next-line no-unused-expressions
  errorBox.offsetWidth;
  errorBox.classList.add("shake");
}

function setHolidayUI(open) {
  if (!els.holidayFields || !els.holidayToggle) return;
  els.holidayFields.classList.toggle("is-open", open);
  els.holidayToggle.setAttribute("aria-expanded", open ? "true" : "false");
}

function readInput() {
  const oklad = parseNumber(els.oklad.value);
  const normHours = parseNumber(els.normHours.value);
  const workedHours = parseNumber(els.workedHours.value);
  const nightHours = parseNumber(els.nightHours.value);

  const holidayEnabled = Boolean(els.holidayToggle?.checked);
  const holidayShiftsRaw = els.holidayShifts ? parseNumber(els.holidayShifts.value) : 0;
  const holidayNightShiftsRaw = els.holidayNightShifts ? parseNumber(els.holidayNightShifts.value) : 0;

  const holidayShifts = holidayEnabled ? holidayShiftsRaw : 0;
  const holidayNightShifts = holidayEnabled ? holidayNightShiftsRaw : 0;

  const bad = [];
  if (Number.isNaN(oklad)) bad.push("Оклад");
  if (Number.isNaN(normHours)) bad.push("Норма часов");
  if (Number.isNaN(workedHours)) bad.push("Отработано часов");
  if (Number.isNaN(nightHours)) bad.push("Ночных часов");
  if (holidayEnabled && Number.isNaN(holidayShiftsRaw)) bad.push("Смен в праздники");
  if (holidayEnabled && Number.isNaN(holidayNightShiftsRaw)) bad.push("Ночных смен в праздники");

  if (bad.length) {
    return { ok: false, error: `Проверьте поля: ${bad.join(", ")}. Используйте только числа.` };
  }

  if (holidayEnabled) {
    if (!(holidayShifts >= 0)) return { ok: false, error: "Количество праздничных смен должно быть числом ≥ 0." };
    if (!(holidayNightShifts >= 0)) return { ok: false, error: "Количество ночных праздничных смен должно быть числом ≥ 0." };
    if (holidayNightShifts > holidayShifts) {
      return { ok: false, error: "Ночных праздничных смен не может быть больше общего количества праздничных смен." };
    }
  }

  return {
    ok: true,
    input: {
      oklad,
      normHours,
      workedHours,
      nightHours,
      holidayEnabled,
      holidayShifts,
      holidayNightShifts,
    },
  };
}

function renderEmpty() {
  const targets = [
    els.net,
    els.hourRate,
    els.baseFact,
    els.bonus,
    els.nightExtra,
    els.advance,
    els.remaining,
  ];
  for (const el of targets) {
    if (el) {
      el.textContent = "—";
      delete el.dataset.value;
    }
  }
  if (els.summary) els.summary.textContent = "";
}

function isAll69(input) {
  return input.oklad === 69 && input.normHours === 69 && input.workedHours === 69 && input.nightHours === 69;
}

function showEgg() {
  eggActive = true;
  eggOverlay.classList.remove("hidden");
  eggOverlay.classList.add("flex");
  eggOverlay.setAttribute("aria-hidden", "false");
  bump(eggText);
}

function hideEgg() {
  eggActive = false;
  eggOverlay.classList.add("hidden");
  eggOverlay.classList.remove("flex");
  eggOverlay.setAttribute("aria-hidden", "true");
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && eggActive) hideEgg();
});

function handleEasterEgg(input) {
  const all69 = isAll69(input);
  if (!all69) {
    wasAll69 = false;
    return;
  }
  if (!eggActive && !wasAll69) showEgg();
  wasAll69 = true;
}

function updateHistoryDropdown() {
  if (!historySelect) return;
  const history = loadHistory();
  historySelect.innerHTML = '<option value="">-- Выберите расчёт --</option>';
  history.forEach((entry, index) => {
    const date = new Date(entry.timestamp).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const option = document.createElement("option");
    option.value = index;
    option.textContent = `${date} – Оклад: ${entry.input.oklad}₽, Отработано: ${entry.input.workedHours}ч, К выплате: ${formatRub(entry.result.net, 0)}`;
    historySelect.appendChild(option);
  });
}

function loadFromHistory(index) {
  const history = loadHistory();
  const entry = history[index];
  if (!entry) return;

  els.oklad.value = entry.input.oklad ?? "";
  els.normHours.value = entry.input.normHours ?? "";
  els.workedHours.value = entry.input.workedHours ?? "";
  els.nightHours.value = entry.input.nightHours ?? "";

  const holidayEnabled = Boolean(entry.input.holidayEnabled);
  if (els.holidayToggle) els.holidayToggle.checked = holidayEnabled;
  setHolidayUI(holidayEnabled);

  if (els.holidayShifts) els.holidayShifts.value = entry.input.holidayShifts ?? "";
  if (els.holidayNightShifts) els.holidayNightShifts.value = entry.input.holidayNightShifts ?? "";

  render();
}

function computeHolidayExtraGross(hourRate, holidayShifts, holidayNightShifts) {
  const dayShifts = Math.max(0, holidayShifts - holidayNightShifts);
  const nightShifts = Math.max(0, holidayNightShifts);

  const dayShiftGross = hourRate * HOLIDAY_SHIFT_HOURS;
  const nightShiftGross =
    hourRate * HOLIDAY_SHIFT_HOURS +
    hourRate * HOLIDAY_NIGHT_HOURS_PER_SHIFT * NIGHT_EXTRA_RATE;

  const baseGross = dayShiftGross * dayShifts + nightShiftGross * nightShifts;

  // x2 pay => add only extra part
  return baseGross * (HOLIDAY_MULTIPLIER - 1);
}

function render() {
  const parsed = readInput();
  if (!parsed.ok) {
    setError(parsed.error);
    renderEmpty();
    return;
  }

  setHolidayUI(Boolean(parsed.input.holidayEnabled));
  handleEasterEgg(parsed.input);

  const calc = computeSalary({
    oklad: parsed.input.oklad,
    normHours: parsed.input.normHours,
    workedHours: parsed.input.workedHours,
    nightHours: parsed.input.nightHours,
  });

  if (!calc.ok) {
    setError(calc.error);
    renderEmpty();
    return;
  }

  setError(null);

  const r = calc.result;

  const holidayExtraGross =
    parsed.input.holidayEnabled && parsed.input.holidayShifts > 0
      ? computeHolidayExtraGross(r.hourRate, parsed.input.holidayShifts, parsed.input.holidayNightShifts)
      : 0;

  const holidayTax = holidayExtraGross * TAX_RATE;
  const holidayNet = holidayExtraGross - holidayTax;

  const netTotal = r.net + holidayNet;
  const grossTotal = r.gross + holidayExtraGross;
  const taxTotal = r.tax + holidayTax;

  addToHistory(parsed.input, { ...r, net: netTotal, gross: grossTotal, tax: taxTotal });
  updateHistoryDropdown();

  const advance = parsed.input.oklad * (1 - TAX_RATE) * 0.54;
  const remaining = netTotal - advance;

  animateNumber(els.net, netTotal, (v) => formatRub(v, 0), 560);
  bump(els.net);

  animateNumber(els.hourRate, r.hourRate, (v) => formatRub(v, 2), 520);
  animateNumber(els.baseFact, r.baseFact, (v) => formatRub(v, 0), 520);
  animateNumber(els.bonus, r.bonus, (v) => formatRub(v, 0), 520);
  animateNumber(els.nightExtra, r.nightExtra, (v) => formatRub(v, 0), 520);

  animateNumber(els.advance, advance, (v) => formatRub(v, 0), 520);
  animateNumber(els.remaining, remaining, (v) => formatRub(v, 0), 520);

  const holidayPart = holidayExtraGross > 0 ? ` • Праздничные: +${formatRub(holidayNet, 0)}` : "";
  els.summary.textContent = `Брутто: ${formatRub(grossTotal, 0)} • Налог: ${formatRub(taxTotal, 0)}${holidayPart}`;

  saveState({ ...parsed.input, _ts: Date.now() });
}

function reset() {
  els.oklad.value = "";
  els.normHours.value = "";
  els.workedHours.value = "";
  els.nightHours.value = "";

  if (els.holidayToggle) els.holidayToggle.checked = false;
  if (els.holidayShifts) els.holidayShifts.value = "";
  if (els.holidayNightShifts) els.holidayNightShifts.value = "";
  setHolidayUI(false);

  clearState();
  hideEgg();
  wasAll69 = false;
  render();
}

function initFromStorage() {
  const saved = loadState();
  if (!saved) return;

  if (typeof saved.oklad === "number") els.oklad.value = String(saved.oklad);
  if (typeof saved.normHours === "number") els.normHours.value = String(saved.normHours);
  if (typeof saved.workedHours === "number") els.workedHours.value = String(saved.workedHours);
  if (typeof saved.nightHours === "number") els.nightHours.value = String(saved.nightHours);

  const holidayEnabled = Boolean(saved.holidayEnabled);
  if (els.holidayToggle) els.holidayToggle.checked = holidayEnabled;
  setHolidayUI(holidayEnabled);

  if (typeof saved.holidayShifts === "number" && els.holidayShifts) els.holidayShifts.value = String(saved.holidayShifts);
  if (typeof saved.holidayNightShifts === "number" && els.holidayNightShifts) els.holidayNightShifts.value = String(saved.holidayNightShifts);
}

form.addEventListener("input", render);
resetBtn.addEventListener("click", reset);

if (els.holidayToggle) {
  els.holidayToggle.addEventListener("change", () => {
    setHolidayUI(Boolean(els.holidayToggle.checked));
    render();
  });
}

if (historySelect) {
  historySelect.addEventListener("change", (e) => {
    const index = e.target.value;
    if (index !== "") loadFromHistory(parseInt(index, 10));
  });
}

if (clearHistoryBtn) {
  clearHistoryBtn.addEventListener("click", () => {
    clearHistory();
    updateHistoryDropdown();
  });
}

initFromStorage();
render();
updateHistoryDropdown();