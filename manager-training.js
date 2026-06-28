import { getMyManagedDepartment, getMyProfile } from "./db.js";
import { getSession } from "./auth.js";

const RESULT_KEY_PREFIX = "alvisa.timesheetTraining.result.v2";
const MANAGER_PROGRESS_KEY_PREFIX = "alvisa.managerTraining.progress.v1";
const CHATEAU_ALVISA_BRANCH = "chateau_alvisa";
const MONTH_DAYS = 28;
const SHORT_DAY_REDUCTION = 1;

const MODES = {
  standard: { key: "standard", label: "стандартная норма", regularDay: 8, longDay: 11, nightCloseDay: 2, continuousNightDay: 4, shortDay: 7 },
  female: { key: "female", label: "женская норма CHATEAU", regularDay: 7.2, longDay: 10.2, nightCloseDay: 1, continuousNightDay: 3, shortDay: 6.2 },
};

const DAYS = Array.from({ length: MONTH_DAYS }, (_, index) => ({
  index,
  date: index + 1,
  dow: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"][index % 7],
  weekend: index % 7 >= 5,
}));

const MARK_NAMES = {
  holiday: "праздник",
  transferred: "перенесённый выходной",
  short: "сокращённый день",
};

const CODE_LABELS = {
  "ОТ": "оплачиваемый отпуск",
  "ОД": "отпуск без оплаты",
  "ОЗ": "обязательный отпуск без оплаты",
  "Б": "больничный",
  "У": "учебный отпуск",
  "УД": "учебный отпуск без оплаты",
  "НТ": "не трудоустроен",
  "УВ": "уволен",
};

const VALID_CODES = new Set(Object.keys(CODE_LABELS));
const ABSENCE_CODE_REFERENCE = [
  ["ОТ", "оплачиваемый отпуск"],
  ["ОД", "отпуск без оплаты"],
  ["ОЗ", "обязательный отпуск без оплаты"],
  ["Б", "больничный"],
  ["У", "оплачиваемый учебный отпуск"],
  ["УД", "учебный отпуск без оплаты"],
];
const EMPLOYMENT_CODE_REFERENCE = [
  ["НТ", "не трудоустроен в этот день"],
  ["УВ", "уволен; все последующие дни заполняются этим кодом автоматически"],
];
const PEOPLE = [
  ["Сотрудник-1", "Оператор", "female"],
  ["Сотрудник-2", "Оператор", "male"],
  ["Сотрудник-3", "Специалист по учёту", "female"],
  ["Сотрудник-4", "Кладовщик", "male"],
  ["Сотрудник-5", "Лаборант", "female"],
  ["Сотрудник-6", "Мастер смены", "male"],
  ["Сотрудник-7", "Бухгалтер", "female"],
  ["Сотрудник-8", "Оператор", "male"],
  ["Сотрудник-9", "Специалист по персоналу", "female"],
  ["Сотрудник-10", "Грузчик", "male"],
];

const elements = {
  trackGroup: document.getElementById("trainingTrackGroup"),
  employeeTrack: document.getElementById("employeeTrackBtn"),
  managerTrack: document.getElementById("managerTrackBtn"),
  employeeRoot: document.getElementById("employeeTrainingRoot"),
  managerRoot: document.getElementById("managerTrainingRoot"),
  pageLead: document.getElementById("trainingPageLead"),
  newVariant: document.getElementById("managerNewVariantBtn"),
  stepCounter: document.getElementById("managerStepCounter"),
  progressText: document.getElementById("managerProgressText"),
  progressBar: document.getElementById("managerProgressBar"),
  strip: document.getElementById("managerMissionStrip"),
  missionArea: document.getElementById("managerMissionArea"),
  title: document.getElementById("managerMissionTitle"),
  description: document.getElementById("managerMissionDescription"),
  briefings: document.getElementById("managerBriefings"),
  selectedDay: document.getElementById("managerSelectedDayLabel"),
  markButtons: [...document.querySelectorAll("[data-manager-mark]")],
  header: document.getElementById("managerTableHeader"),
  body: document.getElementById("managerTableBody"),
  feedback: document.getElementById("managerFeedback"),
  previous: document.getElementById("managerPreviousBtn"),
  reset: document.getElementById("managerResetBtn"),
  check: document.getElementById("managerCheckBtn"),
  completion: document.getElementById("managerCompletionPanel"),
  restart: document.getElementById("managerRestartBtn"),
};

let currentUserId = null;
let managerAvailable = false;
let missionIndex = 0;
let completedMissions = new Set();
let scenario = null;
let employeeStates = [];
let sharedMarks = new Array(MONTH_DAYS).fill(null);
let selectedDayIndex = 0;
let missionPassed = false;
let headerCells = [];

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function shuffledPeople(count, modeKey = null) {
  const source = modeKey === "female" ? PEOPLE.filter((person) => person[2] === "female") : PEOPLE;
  return [...source].sort(() => Math.random() - 0.5).slice(0, count);
}

function formatHours(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return Number.isInteger(number) ? String(number) : number.toFixed(1).replace(".", ",");
}

function modeFromControl() {
  const key = document.querySelector("[data-mode].is-active")?.dataset.mode;
  return MODES[key] || MODES.standard;
}

function modeByKey(key) {
  return MODES[key] || MODES.standard;
}

function markMap(items = []) {
  return new Map(items.map((item) => [item.day - 1, item.type]));
}

function normHoursForDay(dayIndex, mode, marks = sharedMarks) {
  if (DAYS[dayIndex]?.weekend) return 0;
  const mark = Array.isArray(marks) ? marks[dayIndex] : marks.get(dayIndex);
  if (mark === "holiday" || mark === "transferred") return 0;
  return Math.max(0, mode.regularDay - (mark === "short" ? SHORT_DAY_REDUCTION : 0));
}

function monthNorm(mode, marks = sharedMarks) {
  return DAYS.reduce((total, day) => total + normHoursForDay(day.index, mode, marks), 0);
}

function requiredCell(day, row, value) {
  return { day, row, value };
}

function createEmployee({
  person,
  modeKey,
  instruction,
  target,
  tolerance = 0,
  requiredCells = [],
  initialCells = [],
  rule = "day",
  minLongShifts = 0,
  maxRegularDayShifts = Infinity,
  hideTargetDelta = false,
}) {
  const mode = modeByKey(modeKey);
  return {
    id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    name: person[0],
    position: person[1],
    modeKey: mode.key,
    instruction,
    target,
    tolerance,
    requiredCells,
    initialCells,
    rule,
    minLongShifts,
    maxRegularDayShifts,
    hideTargetDelta,
  };
}

function personalNormFromRequirements(employee, requiredMarks, requiredCells) {
  const mode = modeByKey(employee.modeKey);
  const marks = markMap(requiredMarks);
  let result = monthNorm(mode, marks);
  for (const cell of requiredCells) {
    if (cell.row !== "day" || !VALID_CODES.has(cell.value) || cell.value === "УВ") continue;
    result -= normHoursForDay(cell.day - 1, mode, marks);
  }
  return Math.max(0, result);
}

function buildExactPlan() {
  const mode = modeFromControl();
  const person = shuffledPeople(1, mode.key)[0];
  const requiredCells = [22, 23, 24].map((day) => requiredCell(day, "day", "У"));
  const target = personalNormFromRequirements({ modeKey: mode.key }, [], requiredCells);
  return {
    id: "exact-plan",
    title: "Индивидуальный план часов",
    shortTitle: "План часов",
    description: "Составьте сотруднику дневной график. Можно использовать смены с 8:00 до 17:00 и с 8:00 до 20:00; выходные заполнять нельзя.",
    allowedMarks: [],
    requiredMarks: [],
    employees: [createEmployee({
      person,
      modeKey: mode.key,
      target,
      requiredCells,
      initialCells: requiredCells,
      instruction: `22, 23 и 24 числа сотрудник находится на оплачиваемой учебной сессии. В остальные рабочие дни необходимо набрать ровно ${formatHours(target)} ч.`,
      rule: "day",
    })],
  };
}

function buildTeamTargets() {
  const mode = modeFromControl();
  const people = shuffledPeople(3, mode.key);
  const targets = [monthNorm(mode, []) - mode.regularDay, monthNorm(mode, []) - mode.regularDay * 2, monthNorm(mode, []) + 6];
  return {
    id: "team-targets",
    title: "Разные планы внутри отдела",
    shortTitle: "Три сотрудника",
    description: "Заполните сразу несколько строк. У каждого сотрудника собственный план, поэтому ориентируйтесь на итог справа, а не копируйте один график всем.",
    requiredMarks: [],
    employees: people.map((person, index) => createEmployee({
      person,
      modeKey: mode.key,
      target: targets[index],
      tolerance: index === 2 ? 3 : 0,
      instruction: index === 2
        ? `План ${formatHours(targets[index])} ч. Допустимо отклонение до 3 часов в любую сторону.`
        : `Нужно набрать ровно ${formatHours(targets[index])} ч дневными сменами.`,
      rule: "day",
    })),
  };
}

function buildNearestNorm() {
  const mode = modeFromControl();
  const person = shuffledPeople(1, mode.key)[0];
  const target = monthNorm(mode, []);
  return {
    id: "nearest-norm",
    title: "Максимально близко к норме",
    shortTitle: "Близко к норме",
    description: "Найдите наиболее близкий допустимый результат: одну смену можно поставить с 8:00 до 17:00, остальные — только длинные дневные смены или ночные связки.",
    requiredMarks: [],
    employees: [createEmployee({
      person,
      modeKey: mode.key,
      target,
      tolerance: 3,
      maxRegularDayShifts: 1,
      instruction: `Норма ${formatHours(target)} ч. ${formatHours(mode.regularDay)}-часовую смену можно использовать только один раз; остальные смены должны быть ${formatHours(mode.longDay)} ч или ночной связкой 2/2 — ${formatHours(mode.nightCloseDay)}/5.`,
      rule: "nearest-norm",
    })],
  };
}

function buildSickLeave() {
  const mode = modeFromControl();
  const person = shuffledPeople(1, mode.key)[0];
  const sickDays = randomItem([[8, 9, 10], [15, 16], [22, 23, 24]]);
  const requiredCells = sickDays.map((day) => requiredCell(day, "day", "Б"));
  const draft = { modeKey: mode.key };
  const target = personalNormFromRequirements(draft, [], requiredCells);
  return {
    id: "sick-leave",
    title: "Больничный и личная норма",
    shortTitle: "Больничный",
    description: "Отметьте больничный в указанные даты и сформируйте оставшийся график. После отсутствия ориентируйтесь на личную норму сотрудника.",
    requiredMarks: [],
    employees: [createEmployee({
      person,
      modeKey: mode.key,
      target,
      requiredCells,
      instruction: `Больничный: ${sickDays.join(", ")} числа. После его учёта личная норма составит ${formatHours(target)} ч — её нужно отработать полностью.`,
      rule: "day",
      hideTargetDelta: true,
    })],
  };
}

function buildAbsenceMix() {
  const mode = modeFromControl();
  const person = shuffledPeople(1, mode.key)[0];
  const requiredCells = [
    requiredCell(8, "day", "ОТ"),
    requiredCell(9, "day", "ОТ"),
    requiredCell(10, "day", "ОД"),
    requiredCell(15, "day", "У"),
  ];
  const target = personalNormFromRequirements({ modeKey: mode.key }, [], requiredCells);
  return {
    id: "absence-mix",
    title: "Несколько видов отсутствий",
    shortTitle: "Коды отсутствий",
    description: "Правильно расставьте разные коды отсутствий и затем доведите фактические часы до уменьшенной личной нормы.",
    requiredMarks: [],
    reference: ABSENCE_CODE_REFERENCE,
    employees: [createEmployee({
      person,
      modeKey: mode.key,
      target,
      requiredCells,
      instruction: "8-9 числа сотрудник в запланированном отпуске. 10 числа отпросился по личным делам. 14 числа сотруднику пришла выплата, потому что 15 числа его вызвали на сессию.",
      rule: "day",
      hideTargetDelta: true,
    })],
  };
}

function buildCarryover() {
  const mode = modeFromControl();
  const person = shuffledPeople(1, mode.key)[0];
  const carry = randomItem([7, 10, 12]);
  const target = monthNorm(mode, []) + carry;
  return {
    id: "carryover",
    title: "Забытая переработка",
    shortTitle: "Перенос часов",
    description: "Добавьте к текущему месяцу часы, которые забыли учесть ранее. Необязательно попадать в цель идеально: используйте реальные смены и допустимый диапазон.",
    requiredMarks: [],
    employees: [createEmployee({
      person,
      modeKey: mode.key,
      target,
      tolerance: 3,
      instruction: `Норма ${formatHours(monthNorm(mode, []))} ч, забытая переработка ${carry} ч. Допустимое отклонение ±3 ч.`,
      rule: "day",
    })],
  };
}

function buildNightChain() {
  const mode = modeFromControl();
  const person = shuffledPeople(1, mode.key)[0];
  const start = randomItem([8, 15]);
  const requiredCells = [
    requiredCell(start, "day", 2), requiredCell(start, "night", 2),
    requiredCell(start + 1, "day", mode.continuousNightDay), requiredCell(start + 1, "night", 7),
    requiredCell(start + 2, "day", mode.nightCloseDay), requiredCell(start + 2, "night", 5),
  ];
  const target = requiredCells.reduce((sum, cell) => sum + (typeof cell.value === "number" ? cell.value : 0), 0);
  return {
    id: "night-chain",
    title: "Две ночи подряд",
    shortTitle: "Ночные смены",
    description: "Разложите серию ночных смен по календарным датам. В этом задании лишних смен быть не должно.",
    requiredMarks: [],
    employees: [createEmployee({
      person,
      modeKey: mode.key,
      target,
      requiredCells,
      instruction: `Выходы в ночь ${start} и ${start + 1} числа, окончание серии ${start + 2} числа. Заполните только эту серию.`,
      rule: "exact",
    })],
  };
}

function buildEmployment() {
  const mode = modeFromControl();
  const person = shuffledPeople(1, mode.key)[0];
  const requiredCells = [
    requiredCell(1, "day", "НТ"), requiredCell(2, "day", "НТ"), requiredCell(3, "day", "НТ"),
    requiredCell(4, "day", mode.regularDay), requiredCell(5, "day", mode.longDay),
    ...Array.from({ length: MONTH_DAYS - 7 }, (_, index) => requiredCell(index + 8, "day", "УВ")),
  ];
  const target = mode.regularDay + mode.longDay;
  return {
    id: "employment",
    title: "Приём и увольнение",
    shortTitle: "НТ и УВ",
    description: "Покажите период до трудоустройства, две фактические смены и увольнение. После кода «УВ» дальнейшие дни заполняются автоматически.",
    requiredMarks: [],
    reference: EMPLOYMENT_CODE_REFERENCE,
    employees: [createEmployee({
      person,
      modeKey: mode.key,
      target,
      requiredCells,
      instruction: "Сотрудник трудоустроился 4 числа, отработав смену до 5-ти, а на следующий день задержался до 8-ми. В понедельник следующей недели решил уволиться.",
      rule: "exact",
    })],
  };
}

function buildFinalDepartment() {
  const people = shuffledPeople(2, "standard");
  const femalePerson = randomItem(PEOPLE.filter((person) => person[2] === "female" && !people.includes(person)));
  const requiredMarks = [
    { day: 5, type: "holiday" },
    { day: 12, type: "transferred" },
    { day: 19, type: "short" },
  ];
  const marks = markMap(requiredMarks);
  const standard = MODES.standard;
  const female = MODES.female;
  const standardNorm = monthNorm(standard, marks);
  const femaleNorm = monthNorm(female, marks);
  const sickCells = [requiredCell(8, "day", "Б"), requiredCell(9, "day", "Б"), requiredCell(19, "day", standard.shortDay)];
  const sickTarget = personalNormFromRequirements({ modeKey: "standard" }, requiredMarks, sickCells);

  return {
    id: "final-department",
    title: "Итоговый табель отдела",
    shortTitle: "Финал",
    description: "Одновременно настройте календарь отдела и выполните три разных плана. Здесь встречаются обычная и женская нормы, больничный, сокращённый день и перенос переработки.",
    requiredMarks,
    employees: [
      createEmployee({
        person: people[0], modeKey: "standard", target: standardNorm,
        requiredCells: [requiredCell(19, "day", standard.shortDay)], rule: "day",
        instruction: `Отработать личную норму ${formatHours(standardNorm)} ч. 19 числа сотрудник работает сокращённый день.`,
      }),
      createEmployee({
        person: people[1], modeKey: "standard", target: sickTarget,
        requiredCells: sickCells, rule: "day",
        instruction: `Больничный 8–9 числа. После него отработать личную норму ${formatHours(sickTarget)} ч; 19 числа — сокращённая смена.`,
      }),
      createEmployee({
        person: femalePerson, modeKey: "female", target: femaleNorm + 9, tolerance: 3,
        requiredCells: [requiredCell(19, "day", female.shortDay)], rule: "day",
        instruction: `Женская норма CHATEAU: ${formatHours(femaleNorm)} ч плюс 9 забытых часов. Цель ${formatHours(femaleNorm + 9)} ч, допуск ±3 ч.`,
      }),
    ],
  };
}

const MISSIONS = [
  { id: "exact-plan", shortTitle: "План часов", build: buildExactPlan },
  { id: "team-targets", shortTitle: "Три сотрудника", build: buildTeamTargets },
  { id: "nearest-norm", shortTitle: "Близко к норме", build: buildNearestNorm },
  { id: "sick-leave", shortTitle: "Больничный", build: buildSickLeave },
  { id: "absence-mix", shortTitle: "Коды отсутствий", build: buildAbsenceMix },
  { id: "carryover", shortTitle: "Перенос часов", build: buildCarryover },
  { id: "night-chain", shortTitle: "Ночные смены", build: buildNightChain },
  { id: "employment", shortTitle: "НТ и УВ", build: buildEmployment },
  { id: "final-department", shortTitle: "Финал", build: buildFinalDepartment },
];

function normalizeLetters(value) {
  return String(value ?? "").trim().toUpperCase()
    .replaceAll("O", "О").replaceAll("T", "Т").replaceAll("B", "Б")
    .replaceAll("D", "Д").replaceAll("Z", "З").replaceAll("U", "У")
    .replaceAll("Y", "У").replaceAll("N", "Н").replaceAll("V", "В")
    .replace(/\s+/g, "");
}

function parseValue(raw, row) {
  const text = String(raw ?? "").trim();
  if (!text || text === "0") return { kind: "blank", value: null };
  if (row === "day") {
    const code = normalizeLetters(text);
    if (VALID_CODES.has(code)) return { kind: "code", value: code };
  }
  const number = Number(text.replace(",", "."));
  if (Number.isFinite(number) && number >= 0 && number <= 24) return { kind: "number", value: number };
  return { kind: "invalid", value: text };
}

function valuesMatch(actual, expected) {
  if (expected == null) return actual.kind === "blank";
  if (typeof expected === "string") return actual.kind === "code" && actual.value === expected;
  return actual.kind === "number" && Math.abs(actual.value - expected) < 0.001;
}

function createState(employee) {
  const state = {
    employee,
    dayValues: new Array(MONTH_DAYS).fill(""),
    nightValues: new Array(MONTH_DAYS).fill(""),
    dayInputs: [],
    nightInputs: [],
    summaryCell: null,
  };
  for (const cell of employee.initialCells ?? []) {
    const values = cell.row === "day" ? state.dayValues : state.nightValues;
    values[cell.day - 1] = typeof cell.value === "number" ? formatHours(cell.value).replace(",", ".") : cell.value;
  }
  return state;
}

function currentWorked(state) {
  let total = 0;
  for (const values of [state.dayValues, state.nightValues]) {
    for (const raw of values) {
      const parsed = parseValue(raw, values === state.dayValues ? "day" : "night");
      if (parsed.kind === "number") total += parsed.value;
    }
  }
  return total;
}

function currentPersonalNorm(state) {
  const mode = modeByKey(state.employee.modeKey);
  let norm = monthNorm(mode);
  state.dayValues.forEach((raw, index) => {
    const parsed = parseValue(raw, "day");
    if (parsed.kind === "code" && parsed.value !== "УВ") norm -= normHoursForDay(index, mode);
  });
  return Math.max(0, norm);
}

function renderSummary(state) {
  if (!state.summaryCell) return;
  const worked = currentWorked(state);
  const personalNorm = currentPersonalNorm(state);
  const target = state.employee.target;
  const delta = worked - target;
  const deltaLine = state.employee.hideTargetDelta
    ? ""
    : `<div class="text-[11px] ${Math.abs(delta) <= state.employee.tolerance ? "text-emerald-300" : "text-amber-300"}">До цели: ${delta > 0 ? "+" : ""}${formatHours(delta)}</div>`;
  state.summaryCell.innerHTML = `
    <div class="text-[10px] font-semibold uppercase text-slate-500">Отработано</div>
    <div class="mt-1 text-lg font-bold text-slate-100">${formatHours(worked)} ч</div>
    <div class="mt-1 text-[11px] text-slate-400">Норма: ${formatHours(personalNorm)}</div>
    ${deltaLine}
  `;
}

function setManagerFeedback(message, tone = "neutral", details = []) {
  elements.feedback.replaceChildren();
  const summary = document.createElement("div");
  summary.className = "font-semibold";
  summary.textContent = message;
  elements.feedback.appendChild(summary);
  if (details.length) {
    const list = document.createElement("ul");
    list.className = "feedback-details";
    details.slice(0, 7).forEach((detail) => {
      const item = document.createElement("li");
      item.textContent = detail;
      list.appendChild(item);
    });
    elements.feedback.appendChild(list);
  }
  elements.feedback.classList.remove("is-error", "is-success");
  if (tone === "error") elements.feedback.classList.add("is-error");
  if (tone === "success") elements.feedback.classList.add("is-success");
}

function setSelectedDay(index) {
  selectedDayIndex = Math.max(0, Math.min(MONTH_DAYS - 1, index));
  const day = DAYS[selectedDayIndex];
  elements.selectedDay.textContent = `${day.dow}, ${day.date} число`;
  headerCells.forEach((cell, cellIndex) => cell.classList.toggle("is-selected", cellIndex === selectedDayIndex));
  elements.markButtons.forEach((button) => {
    const allowed = !Array.isArray(scenario?.allowedMarks) || scenario.allowedMarks.includes(button.dataset.managerMark);
    button.disabled = !allowed;
    button.title = allowed ? "" : "В этом задании календарные отметки не используются";
    button.setAttribute("aria-pressed", String(sharedMarks[selectedDayIndex] === button.dataset.managerMark));
  });
}

function applyMarkClasses() {
  headerCells.forEach((cell, index) => {
    cell.classList.remove("mark-holiday", "mark-transferred", "mark-short");
    if (sharedMarks[index]) cell.classList.add(`mark-${sharedMarks[index]}`);
  });
  employeeStates.forEach((state) => {
    DAYS.forEach((day) => {
      for (const input of [state.dayInputs[day.index], state.nightInputs[day.index]]) {
        const cell = input?.closest("td");
        if (!cell) continue;
        cell.classList.remove("mark-holiday", "mark-transferred", "mark-short");
        if (sharedMarks[day.index]) cell.classList.add(`mark-${sharedMarks[day.index]}`);
      }
    });
    renderSummary(state);
  });
  setSelectedDay(selectedDayIndex);
}

function clearEvaluation() {
  document.querySelectorAll(".manager-table .is-error, .manager-table .is-correct").forEach((element) => {
    element.classList.remove("is-error", "is-correct");
  });
}

function normalizeInput(input, state, row, index) {
  const wasDismissedCell = row === "day" && parseValue(state.dayValues[index], "day").value === "УВ";
  const parsed = parseValue(input.value, row);
  if (wasDismissedCell && !(parsed.kind === "code" && parsed.value === "УВ")) {
    clearDismissalTail(state, index);
  }
  if (parsed.kind === "number") input.value = formatHours(parsed.value).replace(",", ".");
  else if (parsed.kind === "code") input.value = parsed.value;
  else if (parsed.kind === "blank") input.value = "";
  else input.value = normalizeLetters(input.value);

  if (row === "day") state.dayValues[index] = input.value;
  else state.nightValues[index] = input.value;

  if (row === "day" && parsed.kind === "code") {
    state.nightValues[index] = "";
    if (state.nightInputs[index]) state.nightInputs[index].value = "";
    if (parsed.value === "УВ") {
      fillDismissalTail(state, index + 1);
    }
  }
  applyInputLocks(state);
  renderSummary(state);
}

function clearDismissalTail(state, startIndex) {
  for (let day = startIndex; day < MONTH_DAYS; day += 1) {
    if (parseValue(state.dayValues[day], "day").value !== "УВ") continue;
    state.dayValues[day] = "";
    state.nightValues[day] = "";
    if (state.dayInputs[day]) state.dayInputs[day].value = "";
    if (state.nightInputs[day]) state.nightInputs[day].value = "";
  }
}

function fillDismissalTail(state, startIndex) {
  for (let day = startIndex; day < MONTH_DAYS; day += 1) {
    state.dayValues[day] = "УВ";
    state.nightValues[day] = "";
    if (state.dayInputs[day]) state.dayInputs[day].value = "УВ";
    if (state.nightInputs[day]) state.nightInputs[day].value = "";
  }
}

function applyInputLocks(state) {
  const dismissalIndex = state.dayValues.findIndex((value) => parseValue(value, "day").value === "УВ");
  DAYS.forEach((day) => {
    const dayParsed = parseValue(state.dayValues[day.index], "day");
    const afterDismissal = dismissalIndex >= 0 && day.index > dismissalIndex;
    state.dayInputs[day.index].disabled = afterDismissal;
    state.nightInputs[day.index].disabled = afterDismissal || dayParsed.kind === "code";
  });
}

function handleArrowNavigation(event, state, row, index) {
  if (!event.key.startsWith("Arrow")) return;
  let target = null;
  if (event.key === "ArrowLeft" && index > 0) target = row === "day" ? state.dayInputs[index - 1] : state.nightInputs[index - 1];
  if (event.key === "ArrowRight" && index < MONTH_DAYS - 1) target = row === "day" ? state.dayInputs[index + 1] : state.nightInputs[index + 1];
  if (event.key === "ArrowUp" && row === "night") target = state.dayInputs[index];
  if (event.key === "ArrowDown" && row === "day") target = state.nightInputs[index];
  if (!target || target.disabled) return;
  event.preventDefault();
  target.focus();
  target.select();
}

function createManagerInput(state, row, index) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "manager-input";
  input.autocomplete = "off";
  input.inputMode = row === "night" ? "decimal" : "text";
  input.setAttribute("aria-label", `${state.employee.name}, ${row === "day" ? "день" : "ночь"}, ${index + 1} число`);
  input.addEventListener("focus", () => setSelectedDay(index));
  input.addEventListener("input", () => {
    const previousValue = row === "day" ? state.dayValues[index] : state.nightValues[index];
    if (row === "night") input.value = input.value.replace(/[^0-9.,]/g, "");
    else input.value = input.value.toUpperCase().replace(/\s+/g, "");
    if (row === "day") state.dayValues[index] = input.value;
    else state.nightValues[index] = input.value;
    if (row === "day") {
      const previousWasDismissed = parseValue(previousValue, "day").value === "УВ";
      const currentCode = normalizeLetters(input.value);
      if (previousWasDismissed && currentCode !== "УВ") {
        clearDismissalTail(state, index + 1);
      }
      if (currentCode === "УВ") {
        input.value = "УВ";
        state.dayValues[index] = "УВ";
        state.nightValues[index] = "";
        if (state.nightInputs[index]) state.nightInputs[index].value = "";
        fillDismissalTail(state, index + 1);
      }
    }
    missionPassed = false;
    elements.check.textContent = "Проверить отдел";
    clearEvaluation();
    applyInputLocks(state);
    renderSummary(state);
  });
  input.addEventListener("blur", () => normalizeInput(input, state, row, index));
  input.addEventListener("keydown", (event) => handleArrowNavigation(event, state, row, index));
  return input;
}

function renderTable() {
  elements.header.replaceChildren();
  elements.body.replaceChildren();
  headerCells = [];

  const personHeader = document.createElement("th");
  personHeader.className = "manager-person-cell";
  personHeader.textContent = "Сотрудник";
  const rowHeader = document.createElement("th");
  rowHeader.className = "manager-row-label";
  rowHeader.textContent = "Тип";
  elements.header.append(personHeader, rowHeader);

  DAYS.forEach((day) => {
    const th = document.createElement("th");
    if (day.weekend) th.classList.add("is-weekend");
    th.innerHTML = `<span class="block text-sm font-extrabold">${day.date}</span><span class="mt-0.5 block text-[10px] text-slate-500">${day.dow}</span>`;
    th.addEventListener("click", () => setSelectedDay(day.index));
    elements.header.appendChild(th);
    headerCells.push(th);
  });

  const summaryHeader = document.createElement("th");
  summaryHeader.className = "manager-summary-cell";
  summaryHeader.textContent = "Итоги";
  elements.header.appendChild(summaryHeader);

  employeeStates = scenario.employees.map(createState);
  employeeStates.forEach((state) => {
    const dayRow = document.createElement("tr");
    const nightRow = document.createElement("tr");

    const personCell = document.createElement("td");
    personCell.className = "manager-person-cell";
    personCell.rowSpan = 2;
    personCell.innerHTML = `<div class="truncate text-sm font-bold text-slate-100">${state.employee.name}</div><div class="mt-1 truncate text-[11px] text-slate-400">${state.employee.position}</div><div class="mt-1 text-[10px] text-indigo-200">${modeByKey(state.employee.modeKey).label}</div>`;

    const dayLabel = document.createElement("th");
    dayLabel.className = "manager-row-label";
    dayLabel.textContent = "День";
    const nightLabel = document.createElement("th");
    nightLabel.className = "manager-row-label";
    nightLabel.textContent = "Ночь";
    dayRow.append(personCell, dayLabel);
    nightRow.appendChild(nightLabel);

    DAYS.forEach((day) => {
      const dayCell = document.createElement("td");
      const nightCell = document.createElement("td");
      if (day.weekend) {
        dayCell.classList.add("is-weekend");
        nightCell.classList.add("is-weekend");
      }
      const dayInput = createManagerInput(state, "day", day.index);
      const nightInput = createManagerInput(state, "night", day.index);
      dayCell.appendChild(dayInput);
      nightCell.appendChild(nightInput);
      dayRow.appendChild(dayCell);
      nightRow.appendChild(nightCell);
      state.dayInputs.push(dayInput);
      state.nightInputs.push(nightInput);
    });

    state.dayInputs.forEach((input, index) => {
      input.value = state.dayValues[index] || "";
    });
    state.nightInputs.forEach((input, index) => {
      input.value = state.nightValues[index] || "";
    });

    const summaryCell = document.createElement("td");
    summaryCell.className = "manager-summary-cell";
    summaryCell.rowSpan = 2;
    state.summaryCell = summaryCell;
    dayRow.appendChild(summaryCell);
    elements.body.append(dayRow, nightRow);
    applyInputLocks(state);
    renderSummary(state);
  });

  applyMarkClasses();
  setSelectedDay(0);
}

function renderBriefings() {
  elements.briefings.replaceChildren();
  scenario.employees.forEach((employee) => {
    const item = document.createElement("div");
    item.className = "border-b border-white/10 px-1 pb-3";
    item.innerHTML = `<div class="text-sm font-bold text-slate-100">${employee.name}</div><div class="mt-1 text-xs leading-5 text-slate-300/85">${employee.instruction}</div>`;
    elements.briefings.appendChild(item);
  });

  if (Array.isArray(scenario.reference) && scenario.reference.length) {
    const reference = document.createElement("div");
    reference.className = "rounded-2xl bg-slate-950/35 p-4 ring-1 ring-white/10 lg:col-span-2";

    const title = document.createElement("div");
    title.className = "text-xs font-bold uppercase tracking-wide text-indigo-200";
    title.textContent = "Шпаргалка по кодам";

    const list = document.createElement("div");
    list.className = "mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3";
    scenario.reference.forEach(([code, description]) => {
      const row = document.createElement("div");
      row.className = "flex min-w-0 items-start gap-2 rounded-xl bg-white/[0.035] px-3 py-2 text-xs ring-1 ring-white/10";
      row.innerHTML = `<span class="shrink-0 rounded-lg bg-indigo-500/15 px-2 py-1 font-extrabold text-indigo-100 ring-1 ring-indigo-400/20">${code}</span><span class="min-w-0 pt-1 leading-5 text-slate-300">${description}</span>`;
      list.appendChild(row);
    });

    reference.append(title, list);
    elements.briefings.appendChild(reference);
  }
}

function renderMissionStrip() {
  elements.strip.replaceChildren();
  MISSIONS.forEach((mission, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "lesson-tab";
    if (index === missionIndex) button.classList.add("is-active");
    if (completedMissions.has(mission.id)) button.classList.add("is-complete");
    const number = document.createElement("span");
    number.className = "lesson-tab-number";
    number.textContent = completedMissions.has(mission.id) ? `Задание ${index + 1} · выполнено` : `Задание ${index + 1}`;
    const title = document.createElement("span");
    title.className = "lesson-tab-title";
    title.textContent = mission.shortTitle;
    button.append(number, title);
    button.addEventListener("click", () => loadMission(index));
    elements.strip.appendChild(button);
  });
}

function renderProgress() {
  const count = completedMissions.size;
  elements.stepCounter.textContent = `Задание ${missionIndex + 1} из ${MISSIONS.length}`;
  elements.progressText.textContent = `Выполнено: ${count} из ${MISSIONS.length}`;
  elements.progressBar.style.width = `${Math.round((count / MISSIONS.length) * 100)}%`;
}

function loadMission(index, { keepVariant = false } = {}) {
  missionIndex = Math.max(0, Math.min(MISSIONS.length - 1, index));
  if (!keepVariant || !scenario || scenario.id !== MISSIONS[missionIndex].id) {
    scenario = MISSIONS[missionIndex].build();
  }
  sharedMarks = new Array(MONTH_DAYS).fill(null);
  missionPassed = false;
  selectedDayIndex = 0;
  elements.check.textContent = "Проверить отдел";
  elements.previous.disabled = missionIndex === 0;
  elements.title.textContent = scenario.title;
  elements.description.textContent = scenario.description;
  elements.missionArea.classList.remove("hidden");
  elements.completion.classList.add("hidden");
  renderBriefings();
  renderTable();
  renderMissionStrip();
  renderProgress();
  setManagerFeedback("Прочитайте условия для каждого сотрудника и заполните таблицу.");
  saveManagerProgress();
}

function requiredMap(employee) {
  return new Map(employee.requiredCells.map((cell) => [`${cell.row}:${cell.day - 1}`, cell.value]));
}

function validateEmployee(state, errors) {
  const employee = state.employee;
  const mode = modeByKey(employee.modeKey);
  const required = requiredMap(employee);
  let longShiftCount = 0;
  let regularDayShiftCount = 0;

  for (const cell of employee.requiredCells) {
    const input = cell.row === "day" ? state.dayInputs[cell.day - 1] : state.nightInputs[cell.day - 1];
    const actual = parseValue(input.value, cell.row);
    if (valuesMatch(actual, cell.value)) input.closest("td")?.classList.add("is-correct");
    else {
      input.closest("td")?.classList.add("is-error");
      const expected = typeof cell.value === "string" ? `${cell.value} (${CODE_LABELS[cell.value]})` : `${formatHours(cell.value)} ч`;
      errors.push(`${employee.name}: ${cell.day} число, ${cell.row === "day" ? "день" : "ночь"} — требуется ${expected}.`);
    }
  }

  DAYS.forEach((day) => {
    const dayActual = parseValue(state.dayInputs[day.index].value, "day");
    const nightActual = parseValue(state.nightInputs[day.index].value, "night");
    const dayRequired = required.has(`day:${day.index}`);
    const nightRequired = required.has(`night:${day.index}`);
    const dayCell = state.dayInputs[day.index].closest("td");
    const nightCell = state.nightInputs[day.index].closest("td");

    if (dayActual.kind === "invalid") {
      dayCell?.classList.add("is-error");
      errors.push(`${employee.name}: ${day.date} число, день — некорректное значение.`);
    }
    if (nightActual.kind === "invalid") {
      nightCell?.classList.add("is-error");
      errors.push(`${employee.name}: ${day.date} число, ночь — некорректное значение.`);
    }
    if (dayActual.kind === "number" && nightActual.kind === "number" && dayActual.value + nightActual.value > 24) {
      dayCell?.classList.add("is-error");
      nightCell?.classList.add("is-error");
      errors.push(`${employee.name}: ${day.date} число — в сутки нельзя ставить больше 24 часов.`);
    }

    if (employee.rule === "exact") {
      if (!dayRequired && dayActual.kind !== "blank") {
        state.dayInputs[day.index].closest("td")?.classList.add("is-error");
        errors.push(`${employee.name}: ${day.date} число должно оставаться пустым.`);
      }
      if (!nightRequired && nightActual.kind !== "blank") {
        state.nightInputs[day.index].closest("td")?.classList.add("is-error");
        errors.push(`${employee.name}: лишние ночные часы ${day.date} числа.`);
      }
      return;
    }

    if (employee.rule === "nearest-norm") {
      if (dayActual.kind === "code" && !dayRequired) {
        dayCell?.classList.add("is-error");
        errors.push(`${employee.name}: код ${dayActual.value} ${day.date} числа не указан в условии.`);
      }

      if (dayActual.kind === "number" || nightActual.kind === "number") {
        if (day.weekend || sharedMarks[day.index] === "holiday" || sharedMarks[day.index] === "transferred") {
          dayCell?.classList.add("is-error");
          nightCell?.classList.add("is-error");
          errors.push(`${employee.name}: ${day.date} число является нерабочим.`);
          return;
        }

        const dayValue = dayActual.kind === "number" ? dayActual.value : 0;
        const nightValue = nightActual.kind === "number" ? nightActual.value : 0;
        const isRegularDay = Math.abs(dayValue - mode.regularDay) < 0.001 && nightValue === 0;
        const isLongDay = Math.abs(dayValue - mode.longDay) < 0.001 && nightValue === 0;
        const isNightStart = Math.abs(dayValue - 2) < 0.001 && Math.abs(nightValue - 2) < 0.001;
        const isNightClose = Math.abs(dayValue - mode.nightCloseDay) < 0.001 && Math.abs(nightValue - 5) < 0.001;
        const previousDayActual = day.index > 0 ? parseValue(state.dayInputs[day.index - 1].value, "day") : { kind: "blank" };
        const previousNightActual = day.index > 0 ? parseValue(state.nightInputs[day.index - 1].value, "night") : { kind: "blank" };
        const nextDayActual = day.index < MONTH_DAYS - 1 ? parseValue(state.dayInputs[day.index + 1].value, "day") : { kind: "blank" };
        const nextNightActual = day.index < MONTH_DAYS - 1 ? parseValue(state.nightInputs[day.index + 1].value, "night") : { kind: "blank" };
        const previousIsNightStart = previousDayActual.kind === "number"
          && previousNightActual.kind === "number"
          && Math.abs(previousDayActual.value - 2) < 0.001
          && Math.abs(previousNightActual.value - 2) < 0.001;
        const nextIsNightClose = nextDayActual.kind === "number"
          && nextNightActual.kind === "number"
          && Math.abs(nextDayActual.value - mode.nightCloseDay) < 0.001
          && Math.abs(nextNightActual.value - 5) < 0.001;

        if (isRegularDay) regularDayShiftCount += 1;
        if (isLongDay) longShiftCount += 1;

        if (!isRegularDay && !isLongDay && !isNightStart && !isNightClose) {
          dayCell?.classList.add("is-error");
          nightCell?.classList.add("is-error");
          errors.push(`${employee.name}: ${day.date} числа допустимы только ${formatHours(mode.regularDay)} ч один раз, ${formatHours(mode.longDay)} ч или ночная связка 2/2 — ${formatHours(mode.nightCloseDay)}/5.`);
        }
        if (isNightStart && !nextIsNightClose) {
          dayCell?.classList.add("is-error");
          nightCell?.classList.add("is-error");
          errors.push(`${employee.name}: после 2/2 ${day.date} числа на следующую дату нужно поставить ${formatHours(mode.nightCloseDay)}/5.`);
        }
        if (isNightClose && !previousIsNightStart) {
          dayCell?.classList.add("is-error");
          nightCell?.classList.add("is-error");
          errors.push(`${employee.name}: ${formatHours(mode.nightCloseDay)}/5 ${day.date} числа должно закрывать ночную смену 2/2 на предыдущую дату.`);
        }
      }
      return;
    }

    if (nightActual.kind !== "blank") {
      state.nightInputs[day.index].closest("td")?.classList.add("is-error");
      errors.push(`${employee.name}: в этом задании ночные смены не требуются.`);
    }

    if (dayActual.kind === "code" && !dayRequired) {
      state.dayInputs[day.index].closest("td")?.classList.add("is-error");
      errors.push(`${employee.name}: код ${dayActual.value} ${day.date} числа не указан в условии.`);
    }

    if (dayActual.kind === "number") {
      if (day.weekend || sharedMarks[day.index] === "holiday" || sharedMarks[day.index] === "transferred") {
        state.dayInputs[day.index].closest("td")?.classList.add("is-error");
        errors.push(`${employee.name}: ${day.date} число является нерабочим.`);
        return;
      }
      const allowed = sharedMarks[day.index] === "short"
        ? [mode.shortDay]
        : [mode.regularDay, mode.longDay];
      if (!allowed.some((value) => Math.abs(value - dayActual.value) < 0.001)) {
        state.dayInputs[day.index].closest("td")?.classList.add("is-error");
        errors.push(`${employee.name}: ${day.date} числа используйте допустимую дневную смену (${allowed.map(formatHours).join(" или ")} ч).`);
      }
      if (Math.abs(dayActual.value - mode.longDay) < 0.001) longShiftCount += 1;
      if (Math.abs(dayActual.value - mode.regularDay) < 0.001) regularDayShiftCount += 1;
    }
  });

  if (longShiftCount < employee.minLongShifts) {
    errors.push(`${employee.name}: длинных смен должно быть не меньше ${employee.minLongShifts}, сейчас ${longShiftCount}.`);
  }
  if (regularDayShiftCount > employee.maxRegularDayShifts) {
    errors.push(`${employee.name}: ${formatHours(mode.regularDay)}-часовую смену можно использовать только ${employee.maxRegularDayShifts} раз, сейчас ${regularDayShiftCount}.`);
  }

  const worked = currentWorked(state);
  if (Math.abs(worked - employee.target) > employee.tolerance + 0.001) {
    state.summaryCell?.classList.add("is-error");
    const range = employee.tolerance > 0 ? ` с допуском ±${formatHours(employee.tolerance)} ч` : "";
    errors.push(`${employee.name}: отработано ${formatHours(worked)} ч, цель ${formatHours(employee.target)} ч${range}.`);
  } else {
    state.summaryCell?.classList.add("is-correct");
  }
}

function validateManagerMission() {
  clearEvaluation();
  employeeStates.forEach((state) => {
    state.dayInputs.forEach((input, index) => normalizeInput(input, state, "day", index));
    state.nightInputs.forEach((input, index) => normalizeInput(input, state, "night", index));
  });

  const errors = [];
  const requiredMarks = markMap(scenario.requiredMarks);
  DAYS.forEach((day) => {
    const expected = requiredMarks.get(day.index) || null;
    const actual = sharedMarks[day.index] || null;
    if (expected === actual) {
      if (expected) headerCells[day.index]?.classList.add("is-correct");
      return;
    }
    headerCells[day.index]?.classList.add("is-error");
    if (!expected) errors.push(`${day.date} число: лишняя календарная отметка.`);
    else errors.push(`${day.date} число нужно отметить как «${MARK_NAMES[expected]}».`);
  });

  employeeStates.forEach((state) => validateEmployee(state, errors));

  if (errors.length) {
    setManagerFeedback(`Проверка нашла ошибки: ${errors.length}. Исправьте выделенные места.`, "error", errors);
    return false;
  }

  missionPassed = true;
  completedMissions.add(MISSIONS[missionIndex].id);
  saveManagerProgress();
  saveManagerResult();
  renderMissionStrip();
  renderProgress();
  const isLast = missionIndex === MISSIONS.length - 1;
  elements.check.textContent = isLast ? "Завершить курс" : "Следующее задание";
  setManagerFeedback("Задание выполнено правильно. Итоги отдела соответствуют условиям.", "success");
  return true;
}

function managerProgressKey() {
  return currentUserId ? `${MANAGER_PROGRESS_KEY_PREFIX}:${currentUserId}` : null;
}

function readManagerProgress() {
  const key = managerProgressKey();
  if (!key) return;
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    completedMissions = new Set((Array.isArray(parsed?.completed) ? parsed.completed : []).filter((id) => MISSIONS.some((mission) => mission.id === id)));
    missionIndex = Number.isInteger(parsed?.current) ? Math.max(0, Math.min(MISSIONS.length - 1, parsed.current)) : 0;
  } catch {
    completedMissions = new Set();
    missionIndex = 0;
  }
}

function saveManagerProgress() {
  const key = managerProgressKey();
  if (!key) return;
  localStorage.setItem(key, JSON.stringify({ completed: [...completedMissions], current: missionIndex }));
}

function saveManagerResult() {
  if (!currentUserId) return;
  const key = `${RESULT_KEY_PREFIX}:${currentUserId}`;
  let result = {};
  try {
    result = JSON.parse(localStorage.getItem(key) || "null") || {};
  } catch {
    result = {};
  }
  result.managerCompletedMissions = [...completedMissions];
  result.managerCourseCompleted = completedMissions.size === MISSIONS.length;
  result.updatedAt = new Date().toISOString();
  localStorage.setItem(key, JSON.stringify(result));
}

function renderManagerCompletion() {
  elements.missionArea.classList.add("hidden");
  elements.completion.classList.remove("hidden");
  saveManagerResult();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function switchTrack(track) {
  if (track === "manager" && !managerAvailable) return;
  const manager = track === "manager";
  elements.employeeRoot.classList.toggle("hidden", manager);
  elements.managerRoot.classList.toggle("hidden", !manager);
  elements.employeeTrack.classList.toggle("is-active", !manager);
  elements.managerTrack.classList.toggle("is-active", manager);
  elements.pageLead.textContent = manager
    ? "Управляйте учебным отделом, распределяйте часы и проверяйте себя. Ни одно изменение не попадёт в настоящий табель."
    : "Заполняйте учебную неделю, проверяйте себя и переходите к следующему заданию. Эти данные никогда не попадут в настоящий табель.";
  if (manager) loadMission(missionIndex);
}

function bindEvents() {
  elements.employeeTrack.addEventListener("click", () => switchTrack("employee"));
  elements.managerTrack.addEventListener("click", () => switchTrack("manager"));
  elements.newVariant.addEventListener("click", () => loadMission(missionIndex));
  elements.previous.addEventListener("click", () => loadMission(missionIndex - 1));
  elements.reset.addEventListener("click", () => loadMission(missionIndex, { keepVariant: true }));
  elements.check.addEventListener("click", () => {
    if (!missionPassed) {
      validateManagerMission();
      return;
    }
    if (missionIndex === MISSIONS.length - 1 && completedMissions.size === MISSIONS.length) {
      renderManagerCompletion();
    } else {
      loadMission(Math.min(MISSIONS.length - 1, missionIndex + 1));
    }
  });
  elements.restart.addEventListener("click", () => {
    completedMissions = new Set();
    missionIndex = 0;
    saveManagerProgress();
    loadMission(0);
  });
  elements.markButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      const mark = button.dataset.managerMark;
      if (Array.isArray(scenario?.allowedMarks) && !scenario.allowedMarks.includes(mark)) return;
      sharedMarks[selectedDayIndex] = sharedMarks[selectedDayIndex] === mark ? null : mark;
      missionPassed = false;
      elements.check.textContent = "Проверить отдел";
      clearEvaluation();
      applyMarkClasses();
    });
  });
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!elements.managerRoot.classList.contains("hidden")) {
        queueMicrotask(() => loadMission(missionIndex));
      }
    });
  });
}

async function initialize() {
  bindEvents();
  try {
    const [profile, session] = await Promise.all([getMyProfile(), getSession()]);
    currentUserId = session?.user?.id || null;
    const managedDepartment = profile?.role === "owner" ? { key: "owner" } : await getMyManagedDepartment();
    managerAvailable = Boolean(profile?.role === "owner" || managedDepartment?.key);
  } catch {
    managerAvailable = false;
  }

  if (!managerAvailable) return;
  elements.trackGroup.classList.remove("hidden");
  elements.managerTrack.classList.remove("hidden");
  readManagerProgress();
  renderProgress();
  renderMissionStrip();

  const requestedTrack = new URLSearchParams(window.location.search).get("track");
  if (requestedTrack === "manager") switchTrack("manager");
}

void initialize();
