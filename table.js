// /table.js

// Импортируем вспомогательные функции (можно перенести или продублировать)
// Для простоты скопируем функции анимации из app.js

// Определим prefersReducedMotion
const prefersReducedMotion =
  window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

// Функции анимации (адаптированы из app.js)
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function bump(el) {
  if (prefersReducedMotion) return;
  el.classList.remove("pop");
  // eslint-disable-next-line no-unused-expressions
  el.offsetWidth;
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

function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(1);
}

// Добавляем класс is-loaded для плавного появления
document.body.classList.add("is-loaded");

// Получаем текущую дату
const today = new Date();
const currentYear = today.getFullYear();
const currentMonth = today.getMonth(); // 0-11

const monthNames = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

document.getElementById('monthYearDisplay').textContent = 
  `${monthNames[currentMonth]} ${currentYear}`;

const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

// Состояния
let dayHours = new Array(daysInMonth).fill(0);
let nightHours = new Array(daysInMonth).fill(0);
let isHoliday = new Array(daysInMonth).fill(false);

const headerRow = document.getElementById('headerRow');
const dayRow = document.getElementById('dayRow');
const nightRow = document.getElementById('nightRow');

// Массивы для хранения ссылок на ячейки каждой колонки
const headerCells = [];
const dayCells = [];
const nightCells = [];

// --- Построение таблицы ---

// 1. Заголовок: пустая ячейка + числа месяца
const emptyTh = document.createElement('th');
emptyTh.textContent = ''; // пустая ячейка для подписей строк
headerRow.appendChild(emptyTh);

for (let i = 1; i <= daysInMonth; i++) {
  const th = document.createElement('th');
  th.textContent = i;
  th.dataset.dayIndex = i - 1; // индекс (0-based)
  
  // Определяем выходной – добавляем класс для колонки
  const dayOfWeek = new Date(currentYear, currentMonth, i).getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    th.classList.add('weekend-col');
  }
  
  // Правый клик переключает праздник
  th.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const index = parseInt(e.currentTarget.dataset.dayIndex, 10);
    toggleHoliday(index);
  });
  
  headerRow.appendChild(th);
  headerCells.push(th);
}

// 2. Строка дневных часов
const dayLabelCell = document.createElement('td');
dayLabelCell.textContent = 'День';
dayLabelCell.style.fontWeight = '500';
dayRow.appendChild(dayLabelCell);

for (let i = 0; i < daysInMonth; i++) {
  const td = document.createElement('td');
  td.dataset.dayIndex = i;
  
  // Добавляем класс выходного, если нужно
  const dayOfWeek = new Date(currentYear, currentMonth, i + 1).getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    td.classList.add('weekend-col');
  }
  
  // Правый клик на ячейке
  td.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const index = parseInt(e.currentTarget.dataset.dayIndex, 10);
    toggleHoliday(index);
  });
  
  const input = document.createElement('input');
  input.type = 'number';
  input.min = 0;
  input.step = 0.5;
  input.classList.add('input-hour', 'input-glass');
  input.addEventListener('input', (e) => {
    dayHours[i] = parseFloat(e.target.value) || 0;
    calculateTotals();
  });
  
  td.appendChild(input);
  dayRow.appendChild(td);
  dayCells.push(td);
}

// 3. Строка ночных часов
const nightLabelCell = document.createElement('td');
nightLabelCell.textContent = 'Ночь';
nightLabelCell.style.fontWeight = '500';
nightRow.appendChild(nightLabelCell);

for (let i = 0; i < daysInMonth; i++) {
  const td = document.createElement('td');
  
  // Добавляем класс выходного, если нужно
  const dayOfWeek = new Date(currentYear, currentMonth, i + 1).getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    td.classList.add('weekend-col');
  }
  
  const input = document.createElement('input');
  input.type = 'number';
  input.min = 0;
  input.step = 0.5;
  input.classList.add('input-hour', 'input-glass');
  input.addEventListener('input', (e) => {
    nightHours[i] = parseFloat(e.target.value) || 0;
    calculateTotals();
  });
  
  td.appendChild(input);
  nightRow.appendChild(td);
  nightCells.push(td);
}

// Функция переключения статуса праздника
function toggleHoliday(index) {
  if (index < 0 || index >= daysInMonth) return;
  
  isHoliday[index] = !isHoliday[index];
  
  // Обновляем классы у всей колонки
  const elements = [headerCells[index], dayCells[index], nightCells[index]];
  elements.forEach(el => {
    if (isHoliday[index]) {
      el.classList.add('holiday-col');
    } else {
      el.classList.remove('holiday-col');
    }
  });
  
  // Пересчитываем итоги
  calculateTotals();
}

// Подсчёт итогов с анимацией
let totalHoursEl = document.getElementById('totalHours');
let dayNightHoursEl = document.getElementById('dayNightHours');
let normHoursEl = document.getElementById('normHours');
let overtimeEl = document.getElementById('overtime');

function calculateTotals() {
  let totalDay = 0, totalNight = 0;
  for (let i = 0; i < daysInMonth; i++) {
    totalDay += dayHours[i];
    totalNight += nightHours[i];
  }
  const total = totalDay + totalNight;
  
  // Количество рабочих дней (пн-пт)
  let workDaysCount = 0;
  for (let i = 1; i <= daysInMonth; i++) {
    const dayOfWeek = new Date(currentYear, currentMonth, i).getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      workDaysCount++;
    }
  }
  
  // Праздники уменьшают норму
  const holidayCount = isHoliday.filter(Boolean).length;
  const norm = workDaysCount * 8 - holidayCount * 8;
  
  const overtime = total - norm;
  
  // Анимируем обновление
  animateNumber(totalHoursEl, total, formatNumber, 560);
  bump(totalHoursEl);
  
  // Для dayNightHours используем строку, но тоже можем применить pop к самому элементу
  dayNightHoursEl.textContent = `${totalDay.toFixed(1)} / ${totalNight.toFixed(1)}`;
  bump(dayNightHoursEl);
  
  animateNumber(normHoursEl, norm, formatNumber, 560);
  bump(normHoursEl);
  
  animateNumber(overtimeEl, overtime, (v) => (v >= 0 ? '+' : '') + v.toFixed(1), 560);
  bump(overtimeEl);
}

// Первый расчёт
calculateTotals();