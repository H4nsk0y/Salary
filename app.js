// /app.js

import { computeSalary, parseNumber, TAX_RATE } from "./calc.js";
import { clearState, loadState, saveState } from "./storage.js";

// PWA: регистрация service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(registration => {
      console.log('ServiceWorker registered: ', registration);
    }).catch(error => {
      console.log('ServiceWorker registration failed: ', error);
    });
  });
}

document.body.classList.add("is-loaded");

const form = document.getElementById("salaryForm");
const errorBox = document.getElementById("errorBox");
const resetBtn = document.getElementById("resetBtn");

const eggOverlay = document.getElementById("easterEgg");
const eggText = document.getElementById("easterText");

// Элементы формы и результатов
const els = {
  oklad: document.getElementById("oklad"),
  normHours: document.getElementById("normHours"),
  workedHours: document.getElementById("workedHours"),
  nightHours: document.getElementById("nightHours"),

  net: document.getElementById("net"),
  summary: document.getElementById("summary"),

  hourRate: document.getElementById("hourRate"),
  baseFact: document.getElementById("baseFact"),
  bonus: document.getElementById("bonus"),
  nightExtra: document.getElementById("nightExtra"),

  // Новые элементы для аванса и остатка
  advance: document.getElementById("advance"),
  remaining: document.getElementById("remaining"),
};

const prefersReducedMotion =
  window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

let eggActive = false;
let wasAll69 = false;

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
  if (prefersReducedMotion) return;
  el.classList.remove("pop");
  el.offsetWidth; // форсируем reflow
  el.classList.add("pop");
}

function animateNumber(el, to, formatter, durationMs = 520) {
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
  errorBox.offsetWidth;
  errorBox.classList.add("shake");
}

function readInput() {
  const oklad = parseNumber(els.oklad.value);
  const normHours = parseNumber(els.normHours.value);
  const workedHours = parseNumber(els.workedHours.value);
  const nightHours = parseNumber(els.nightHours.value);

  const bad = [];
  if (Number.isNaN(oklad)) bad.push("Оклад");
  if (Number.isNaN(normHours)) bad.push("Норма часов");
  if (Number.isNaN(workedHours)) bad.push("Отработано часов");
  if (Number.isNaN(nightHours)) bad.push("Ночных часов");

  if (bad.length) {
    return {
      ok: false,
      error: `Проверьте поля: ${bad.join(", ")}. Используйте только числа.`,
    };
  }

  return { ok: true, input: { oklad, normHours, workedHours, nightHours } };
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
  els.summary.textContent = "";
}

function isAll69(input) {
  return (
    input.oklad === 69 &&
    input.normHours === 69 &&
    input.workedHours === 69 &&
    input.nightHours === 69
  );
}

function showEgg() {
  eggActive = true;
  eggOverlay.classList.remove("hidden");
  eggOverlay.classList.add("flex");
  eggOverlay.setAttribute("aria-hidden", "false");
  if (eggText) bump(eggText);
}

function hideEgg() {
  eggActive = false;
  eggOverlay.classList.add("hidden");
  eggOverlay.classList.remove("flex");
  eggOverlay.setAttribute("aria-hidden", "true");
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && eggActive) {
    hideEgg();
  }
});

function handleEasterEgg(input) {
  const all69 = isAll69(input);

  if (!all69) {
    wasAll69 = false;
    return;
  }

  if (!eggActive && !wasAll69) {
    showEgg();
  }

  wasAll69 = true;
}

function render() {
  const parsed = readInput();
  if (!parsed.ok) {
    setError(parsed.error);
    renderEmpty();
    return;
  }

  handleEasterEgg(parsed.input);

  const calc = computeSalary(parsed.input);
  if (!calc.ok) {
    setError(calc.error);
    renderEmpty();
    return;
  }

  setError(null);

  const r = calc.result;

  // Расчёт аванса: (оклад - 13%) * 40%
  const advance = parsed.input.oklad * (1 - TAX_RATE) * 0.4;
  // Остаток = сумма к выплате минус аванс
  const remaining = r.net - advance;

  // Анимация основных полей
  animateNumber(els.net, r.net, (v) => formatRub(v, 0), 560);
  bump(els.net);

  animateNumber(els.hourRate, r.hourRate, (v) => formatRub(v, 2), 520);
  animateNumber(els.baseFact, r.baseFact, (v) => formatRub(v, 0), 520);
  animateNumber(els.bonus, r.bonus, (v) => formatRub(v, 0), 520);
  animateNumber(els.nightExtra, r.nightExtra, (v) => formatRub(v, 0), 520);

  // Анимация новых полей
  animateNumber(els.advance, advance, (v) => formatRub(v, 0), 520);
  animateNumber(els.remaining, remaining, (v) => formatRub(v, 0), 520);

  // Краткая сводка (gross и tax всё ещё нужны для отображения)
  els.summary.textContent = `Брутто: ${formatRub(r.gross, 0)} • Налог: ${formatRub(r.tax, 0)}`;

  saveState({ ...parsed.input, _ts: Date.now() });
}

function reset() {
  els.oklad.value = "";
  els.normHours.value = "";
  els.workedHours.value = "";
  els.nightHours.value = "";
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
}

form.addEventListener("input", render);
resetBtn.addEventListener("click", reset);

initFromStorage();
render();