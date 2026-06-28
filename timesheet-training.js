import { getMyProfile } from "./db.js";
import { getSession } from "./auth.js";
import { confirmDialog } from "./modal.js";

const PROGRESS_KEY = "alvisa.timesheetTraining.v1";
const ACHIEVEMENT_KEY_PREFIX = "alvisa.timesheetTraining.completedOnce.v1";
const RESULT_KEY_PREFIX = "alvisa.timesheetTraining.result.v2";
const CHATEAU_ALVISA_BRANCH = "chateau_alvisa";
const AUTO_ADVANCE_MS = 1150;

const DAYS = [
  { short: "Пн", full: "Понедельник", date: 1, weekend: false },
  { short: "Вт", full: "Вторник", date: 2, weekend: false },
  { short: "Ср", full: "Среда", date: 3, weekend: false },
  { short: "Чт", full: "Четверг", date: 4, weekend: false },
  { short: "Пт", full: "Пятница", date: 5, weekend: false },
  { short: "Сб", full: "Суббота", date: 6, weekend: true },
  { short: "Вс", full: "Воскресенье", date: 7, weekend: true },
];

const MODES = {
  standard: {
    key: "standard",
    label: "Стандартная норма",
    regularDay: 8,
    longDay: 11,
    nightCloseDay: 2,
    continuousNightDay: 4,
    shortDay: 7,
  },
  female: {
    key: "female",
    label: "Женская норма CHATEAU ALVISA",
    regularDay: 7.2,
    longDay: 10.2,
    nightCloseDay: 1,
    continuousNightDay: 3,
    shortDay: 6.2,
  },
};

const MARK_LABELS = {
  holiday: "П",
  transferred: "В",
  short: "С",
};

const MARK_NAMES = {
  holiday: "праздник",
  transferred: "перенесённый выходной",
  short: "сокращённый день",
};

const CODE_LABELS = {
  "ОТ": "оплачиваемый отпуск",
  "ОД": "отпуск без оплаты по заявлению",
  "ОЗ": "обязательный отпуск без оплаты",
  "Б": "больничный",
  "У": "оплачиваемый учебный отпуск",
  "УД": "учебный отпуск без оплаты",
  "НТ": "ещё не трудоустроен",
  "УВ": "уволен",
};

const TRAINING_TOPICS = [
  { id: "day", label: "Дневные смены", lessons: ["basics", "five-day"] },
  { id: "night", label: "Ночные смены", lessons: ["day-night-rest", "continuous-nights"] },
  { id: "absence", label: "Коды отсутствий", lessons: ["absence-codes"] },
  { id: "calendar", label: "Особые дни", lessons: ["calendar-marks"] },
  { id: "employment", label: "Приём и увольнение", lessons: ["employment-codes"] },
  { id: "exam", label: "Итоговый экзамен", lessons: ["final-exam"] },
];

const VALID_CODES = new Set(["ОТ", "ОД", "ОЗ", "Б", "У", "УД", "НТ", "УВ"]);

function emptyValues() {
  return new Array(DAYS.length).fill(null);
}

function week(day = emptyValues(), night = emptyValues(), marks = emptyValues()) {
  return { day, night, marks };
}

const EXAM_SCENARIOS = [
  {
    id: "day-night-short",
    description: "Понедельник — дневная смена с 8:00 до 20:00; вторник — выход в ночь; среда — окончание ночной смены; четверг — оплачиваемый отпуск; пятница — сокращённая дневная смена с 8:00 до 17:00.",
    expected: (mode) => week(
      [mode.longDay, 2, mode.nightCloseDay, "ОТ", mode.shortDay, null, null],
      [null, 2, 5, null, null, null, null],
      [null, null, null, null, "short", null, null]
    ),
  },
  {
    id: "continuous-nights",
    description: "Сотрудник выходит в ночь в понедельник и ещё раз во вторник. В среду ночная серия заканчивается; четверг отмечен больничным; пятница является перенесённым выходным.",
    expected: (mode) => week(
      [2, mode.continuousNightDay, mode.nightCloseDay, "Б", null, null, null],
      [2, 7, 5, null, null, null, null],
      [null, null, null, null, "transferred", null, null]
    ),
  },
  {
    id: "employment",
    description: "В понедельник сотрудник ещё не трудоустроен; во вторник работает с 8:00 до 17:00; в среду — с 8:00 до 20:00; четверг является оплачиваемым учебным отпуском; в пятницу сотрудник уволен.",
    expected: (mode) => week(["НТ", mode.regularDay, mode.longDay, "У", "УВ", "УВ", "УВ"]),
  },
  {
    id: "holiday-night",
    description: "Понедельник является праздником; во вторник сотрудник работает с 8:00 до 17:00; в среду выходит в ночь; в четверг заканчивает ночную смену; в пятницу находится в отпуске без оплаты по заявлению.",
    expected: (mode) => week(
      [null, mode.regularDay, 2, mode.nightCloseDay, "ОД", null, null],
      [null, null, 2, 5, null, null, null],
      ["holiday", null, null, null, null, null, null]
    ),
  },
  {
    id: "mixed-week",
    description: "Понедельник — обычная дневная смена с 8:00 до 17:00; вторник — сокращённая дневная смена с тем же временем начала; среда — оплачиваемый отпуск; четверг — дневная смена с 8:00 до 20:00; пятница является праздником.",
    expected: (mode) => week(
      [mode.regularDay, mode.shortDay, "ОТ", mode.longDay, null, null, null],
      emptyValues(),
      [null, "short", null, null, "holiday", null, null]
    ),
  },
];

const LESSONS = [
  {
    id: "basics",
    type: "theory",
    title: "Как устроены смены",
    shortTitle: "Основы",
    description: "Разберём дневную смену, обычную ночь и переход из ночи в ночь на маленьких фрагментах табеля.",
  },
  {
    id: "five-day",
    type: "exercise",
    title: "Обычная пятидневка",
    shortTitle: "Пятидневка",
    description: "Заполните неделю так, будто вы работаете с понедельника по пятницу с 8:00 до 17:00. Субботу и воскресенье оставьте пустыми.",
    hint: (mode) => `Все рабочие часы находятся в строке «День»: по ${formatHours(mode.regularDay)} часа с понедельника по пятницу. Ночную строку заполнять не нужно.`,
    expected: (mode) => week(
      [mode.regularDay, mode.regularDay, mode.regularDay, mode.regularDay, mode.regularDay, null, null]
    ),
  },
  {
    id: "day-night-rest",
    type: "exercise",
    title: "День, ночь, отсыпной",
    shortTitle: "День / ночь",
    description: (mode) => `График недели: понедельник — дневная смена 8:00–20:00 (${formatHours(mode.longDay)} часа); вторник — выход в ночь; среда — окончание ночной смены и отсыпной. Затем повторите цикл с четверга.`,
    hint: (mode) => `Выход в ночь отмечается как 2/2, а окончание ночи на следующую дату — ${formatHours(mode.nightCloseDay)}/5.`,
    expected: (mode) => week(
      [mode.longDay, 2, mode.nightCloseDay, mode.longDay, 2, mode.nightCloseDay, null],
      [null, 2, 5, null, 2, 5, null]
    ),
  },
  {
    id: "continuous-nights",
    type: "exercise",
    title: "Несколько ночей подряд",
    shortTitle: "Ночи подряд",
    description: "Сотрудник выходит в ночную смену в понедельник, вторник и среду. В четверг серия ночей заканчивается. Остальные дни оставьте пустыми.",
    hint: (mode) => `В промежуточную дату складываются окончание предыдущей ночи и начало следующей: ${formatHours(mode.continuousNightDay)}/7. Завершение серии — ${formatHours(mode.nightCloseDay)}/5.`,
    expected: (mode) => week(
      [2, mode.continuousNightDay, mode.continuousNightDay, mode.nightCloseDay, null, null, null],
      [2, 7, 7, 5, null, null, null]
    ),
  },
  {
    id: "absence-codes",
    type: "exercise",
    title: "Коды отсутствий",
    shortTitle: "Отсутствия",
    description: "Понедельник и вторник — оплачиваемый отпуск; среда — больничный; четверг — оплачиваемый учебный отпуск; пятница — отпуск без оплаты по заявлению.",
    hint: "Коды вводятся только в строку «День». Ночная ячейка после кода блокируется автоматически.",
    reference: [
      ["ОТ", "оплачиваемый отпуск"],
      ["Б", "больничный"],
      ["ОД", "отпуск без оплаты по заявлению"],
      ["ОЗ", "обязательный отпуск без оплаты"],
      ["У", "оплачиваемый учебный отпуск"],
      ["УД", "учебный отпуск без оплаты"],
    ],
    expected: () => week(["ОТ", "ОТ", "Б", "У", "ОД", null, null]),
  },
  {
    id: "calendar-marks",
    type: "exercise",
    title: "Особые дни календаря",
    shortTitle: "Особые дни",
    description: "Отметьте вторник как праздник, четверг как перенесённый выходной, а пятницу как сокращённый день. Часы вводить не нужно.",
    hint: "Сначала выберите нужный столбец табеля, затем нажмите одну из кнопок над таблицей.",
    expected: () => week(
      emptyValues(),
      emptyValues(),
      [null, "holiday", null, "transferred", "short", null, null]
    ),
  },
  {
    id: "employment-codes",
    type: "exercise",
    title: "Приём и увольнение",
    shortTitle: "НТ и УВ",
    description: (mode) => `Сотрудник ещё не трудоустроен в понедельник и вторник, работает по ${formatHours(mode.regularDay)} часа в среду и четверг, а в пятницу уволен.`,
    hint: (mode) => `До начала работы ставится НТ. В среду и четверг укажите по ${formatHours(mode.regularDay)} часа. Код УВ блокирует все последующие ячейки.`,
    reference: [
      ["НТ", "ещё не трудоустроен"],
      ["УВ", "уволен; дальнейшие дни блокируются"],
    ],
    expected: (mode) => week(["НТ", "НТ", mode.regularDay, mode.regularDay, "УВ", "УВ", "УВ"]),
  },
  {
    id: "final-exam",
    type: "exercise",
    isExam: true,
    title: "Итоговый экзамен",
    shortTitle: "Экзамен",
    description: "Случайное итоговое задание без предварительной подсказки.",
  },
];

const elements = {
  modeButtons: [...document.querySelectorAll("[data-mode]")],
  modeHint: document.getElementById("modeHint"),
  stepCounter: document.getElementById("stepCounter"),
  progressText: document.getElementById("progressText"),
  progressBar: document.getElementById("progressBar"),
  resetProgress: document.getElementById("resetProgressBtn"),
  lessonStrip: document.getElementById("lessonStrip"),
  lessonArea: document.getElementById("lessonArea"),
  lessonKind: document.getElementById("lessonKind"),
  lessonTitle: document.getElementById("lessonTitle"),
  lessonDescription: document.getElementById("lessonDescription"),
  lessonStatus: document.getElementById("lessonStatus"),
  theoryPanel: document.getElementById("theoryPanel"),
  theoryExamples: document.getElementById("theoryExamples"),
  exercisePanel: document.getElementById("exercisePanel"),
  lessonReference: document.getElementById("lessonReference"),
  lessonReferenceTitle: document.getElementById("lessonReferenceTitle"),
  lessonReferenceList: document.getElementById("lessonReferenceList"),
  selectedDayLabel: document.getElementById("selectedDayLabel"),
  markButtons: [...document.querySelectorAll("[data-mark]")],
  headerRow: document.getElementById("trainingHeaderRow"),
  dayRow: document.getElementById("trainingDayRow"),
  nightRow: document.getElementById("trainingNightRow"),
  feedback: document.getElementById("feedbackBox"),
  actions: document.getElementById("lessonActions"),
  previous: document.getElementById("previousLessonBtn"),
  resetLesson: document.getElementById("resetLessonBtn"),
  newExam: document.getElementById("newExamBtn"),
  primary: document.getElementById("primaryLessonBtn"),
  completion: document.getElementById("completionPanel"),
  completionTopics: document.getElementById("completionTopics"),
  completionExamResult: document.getElementById("completionExamResult"),
  restart: document.getElementById("restartCourseBtn"),
  successOverlay: document.getElementById("successOverlay"),
  successMessage: document.getElementById("successMessage"),
};

let modeKey = "standard";
let modeTouched = false;
let userStartedExercise = false;
let lessonIndex = 0;
let selectedDayIndex = 0;
let attempts = 0;
let completedLessons = new Set();
let courseFinished = false;
let autoAdvanceTimer = null;
let currentUserId = null;
let activeExamScenario = null;
let lastExamScore = null;

let headerCells = [];
let dayInputs = [];
let nightInputs = [];
let marks = emptyValues();

function currentLesson() {
  return LESSONS[lessonIndex];
}

function currentMode() {
  return MODES[modeKey] || MODES.standard;
}

function resolveLessonText(value, mode = currentMode()) {
  return typeof value === "function" ? value(mode) : String(value || "");
}

function pickExamScenario() {
  const index = Math.floor(Math.random() * EXAM_SCENARIOS.length);
  return EXAM_SCENARIOS[index] || EXAM_SCENARIOS[0];
}

function ensureExamScenario() {
  if (!activeExamScenario) activeExamScenario = pickExamScenario();
  return activeExamScenario;
}

function resolveLessonDescription(lesson) {
  if (lesson?.isExam) return ensureExamScenario().description;
  return resolveLessonText(lesson?.description);
}

function getExpectedWeek(lesson) {
  if (lesson?.isExam) return ensureExamScenario().expected(currentMode());
  return lesson.expected(currentMode());
}

function isFemaleChateauProfile(profile) {
  const gender = String(profile?.gender || "").trim().toLowerCase();
  const branch = String(profile?.branch || "").trim().toLowerCase().replaceAll(" ", "_");
  return gender === "female" && branch === CHATEAU_ALVISA_BRANCH;
}

function readProgress() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return;

    completedLessons = new Set(
      (Array.isArray(parsed.completed) ? parsed.completed : [])
        .filter((id) => LESSONS.some((lesson) => lesson.id === id))
    );
    lessonIndex = Number.isInteger(parsed.current)
      ? Math.min(LESSONS.length - 1, Math.max(0, parsed.current))
      : 0;
    courseFinished = parsed.finished === true && completedLessons.size === LESSONS.length;
  } catch {
    completedLessons = new Set();
    lessonIndex = 0;
    courseFinished = false;
  }
}

function saveProgress() {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify({
    completed: [...completedLessons],
    current: lessonIndex,
    finished: courseFinished,
  }));
}

function rememberTrainingCompletion() {
  if (!currentUserId) return;
  localStorage.setItem(`${ACHIEVEMENT_KEY_PREFIX}:${currentUserId}`, new Date().toISOString());
}

function readTrainingResult() {
  if (!currentUserId) return { masteredLessons: [], bestExamScore: 0 };

  try {
    const parsed = JSON.parse(localStorage.getItem(`${RESULT_KEY_PREFIX}:${currentUserId}`) || "null");
    return {
      masteredLessons: Array.isArray(parsed?.masteredLessons) ? parsed.masteredLessons : [],
      bestExamScore: Number.isFinite(Number(parsed?.bestExamScore)) ? Number(parsed.bestExamScore) : 0,
    };
  } catch {
    return { masteredLessons: [], bestExamScore: 0 };
  }
}

function rememberTrainingProgress() {
  if (!currentUserId) return;

  const previous = readTrainingResult();
  const masteredLessons = [...new Set([...previous.masteredLessons, ...completedLessons])];
  const bestExamScore = Math.max(previous.bestExamScore, Number(lastExamScore) || 0);

  localStorage.setItem(`${RESULT_KEY_PREFIX}:${currentUserId}`, JSON.stringify({
    masteredLessons,
    bestExamScore,
    updatedAt: new Date().toISOString(),
  }));
}

async function resolveTrainingUser() {
  try {
    const session = await getSession();
    currentUserId = session?.user?.id || null;
    rememberTrainingProgress();
    if (courseFinished) rememberTrainingCompletion();
  } catch {
    currentUserId = null;
  }
}

function formatHours(value) {
  if (value == null || value === "") return "—";
  if (typeof value === "string") return value;
  return Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
}

function createSnippet({ title, description, columns, day, night }) {
  const article = document.createElement("article");
  article.className = "theory-example";

  const heading = document.createElement("h3");
  heading.className = "text-base font-bold text-slate-100";
  heading.textContent = title;

  const text = document.createElement("p");
  text.className = "mt-1 text-xs leading-5 text-slate-400";
  text.textContent = description;

  const table = document.createElement("table");
  table.className = "snippet-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  const corner = document.createElement("th");
  corner.textContent = "";
  headerRow.appendChild(corner);
  for (const column of columns) {
    const th = document.createElement("th");
    th.textContent = column;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);

  const tbody = document.createElement("tbody");
  for (const [label, values] of [["День", day], ["Ночь", night]]) {
    const row = document.createElement("tr");
    const rowHead = document.createElement("th");
    rowHead.textContent = label;
    row.appendChild(rowHead);
    for (const value of values) {
      const td = document.createElement("td");
      td.textContent = formatHours(value);
      row.appendChild(td);
    }
    tbody.appendChild(row);
  }

  table.append(thead, tbody);
  article.append(heading, text, table);
  return article;
}

function renderTheory() {
  const mode = currentMode();
  elements.theoryExamples.replaceChildren(
    createSnippet({
      title: "День с 8:00 до 17:00",
      description: "Обычная дневная смена целиком записывается в строку «День».",
      columns: ["Дата"],
      day: [mode.regularDay],
      night: [null],
    }),
    createSnippet({
      title: "День с 8:00 до 20:00",
      description: "Продолжительная дневная смена также не затрагивает строку «Ночь».",
      columns: ["Дата"],
      day: [mode.longDay],
      night: [null],
    }),
    createSnippet({
      title: "Обычная ночная смена",
      description: "Выход в ночь и её окончание относятся к разным календарным датам.",
      columns: ["Выход", "Следующая дата"],
      day: [2, mode.nightCloseDay],
      night: [2, 5],
    }),
    createSnippet({
      title: "Переход из ночи в ночь",
      description: "В средней дате соединяются окончание предыдущей ночи и начало следующей.",
      columns: ["Начало", "Ночь → ночь", "Окончание"],
      day: [2, mode.continuousNightDay, mode.nightCloseDay],
      night: [2, 7, 5],
    })
  );
}

function normalizeLetters(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replaceAll("O", "О")
    .replaceAll("T", "Т")
    .replaceAll("B", "Б")
    .replaceAll("D", "Д")
    .replaceAll("Z", "З")
    .replaceAll("U", "У")
    .replaceAll("Y", "У")
    .replaceAll("N", "Н")
    .replaceAll("V", "В")
    .replaceAll("L", "Л")
    .replace(/\s+/g, "");
}

function normalizeCode(value) {
  const token = normalizeLetters(value);
  if (token === "О") return "ОТ";
  if (token === "БЛ") return "Б";
  return VALID_CODES.has(token) ? token : null;
}

function parseActual(value, row) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "0" || raw === "0.0" || raw === "0,0") return { kind: "blank", value: null };

  if (row === "day") {
    const code = normalizeCode(raw);
    if (code) return { kind: "code", value: code };
  }

  const number = Number(raw.replace(",", "."));
  if (Number.isFinite(number) && number >= 0) return { kind: "number", value: number };
  return { kind: "invalid", value: raw };
}

function isCodeValue(value) {
  return typeof value === "string" && VALID_CODES.has(value);
}

function formatInputValue(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return Number.isInteger(value) ? String(value) : String(value);
}

function valuesMatch(actual, expected) {
  if (expected == null || expected === "") {
    return actual.kind === "blank" || (actual.kind === "number" && Math.abs(actual.value) < 0.001);
  }

  if (isCodeValue(expected)) return actual.kind === "code" && actual.value === expected;
  return actual.kind === "number" && Math.abs(actual.value - Number(expected)) < 0.001;
}

function createRowLabel(text) {
  const th = document.createElement("th");
  th.className = "row-label";
  th.scope = "row";
  th.textContent = text;
  return th;
}

function buildTrainingTable() {
  headerCells = [];
  dayInputs = [];
  nightInputs = [];
  marks = emptyValues();
  selectedDayIndex = 0;

  elements.headerRow.replaceChildren();
  elements.dayRow.replaceChildren();
  elements.nightRow.replaceChildren();

  const corner = createRowLabel("");
  corner.scope = "col";
  elements.headerRow.appendChild(corner);

  DAYS.forEach((day, index) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.dataset.dayIndex = String(index);
    if (day.weekend) th.classList.add("weekend-cell");

    const date = document.createElement("span");
    date.className = "block text-sm font-extrabold";
    date.textContent = String(day.date);

    const dow = document.createElement("span");
    dow.className = "mt-0.5 block text-[10px] font-semibold text-slate-500";
    dow.textContent = day.short;

    const badge = document.createElement("span");
    badge.className = "mark-badge";
    badge.setAttribute("aria-hidden", "true");

    th.append(date, dow, badge);
    th.addEventListener("click", () => setSelectedDay(index));
    elements.headerRow.appendChild(th);
    headerCells.push(th);
  });

  elements.dayRow.appendChild(createRowLabel("День"));
  elements.nightRow.appendChild(createRowLabel("Ночь"));

  DAYS.forEach((day, index) => {
    const dayCell = document.createElement("td");
    const nightCell = document.createElement("td");
    if (day.weekend) {
      dayCell.classList.add("weekend-cell");
      nightCell.classList.add("weekend-cell");
    }

    const dayInput = createTrainingInput("day", index);
    const nightInput = createTrainingInput("night", index);
    dayCell.appendChild(dayInput);
    nightCell.appendChild(nightInput);
    elements.dayRow.appendChild(dayCell);
    elements.nightRow.appendChild(nightCell);
    dayInputs.push(dayInput);
    nightInputs.push(nightInput);
  });

  applyInputLocks();
  renderMarks();
  setSelectedDay(0);
}

function createTrainingInput(row, index) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "trainer-input";
  input.dataset.row = row;
  input.dataset.dayIndex = String(index);
  input.inputMode = row === "night" ? "decimal" : "text";
  input.autocomplete = "off";
  input.autocapitalize = "characters";
  input.spellcheck = false;
  input.setAttribute("aria-label", `${row === "day" ? "День" : "Ночь"}, ${DAYS[index].full}`);

  input.addEventListener("focus", () => {
    input.dataset.prevValue = input.value ?? "";
    setSelectedDay(index);
  });
  input.addEventListener("input", () => {
    userStartedExercise = true;
    if (row === "night") {
      input.value = input.value.replace(/[^0-9.,]/g, "");
    } else {
      input.value = input.value.toUpperCase().replace(/\s+/g, "");
    }
    clearEvaluation();
    setFeedback("Заполнение изменено. Нажмите «Проверить», когда закончите.");
  });
  input.addEventListener("blur", () => normalizeInput(input));
  input.addEventListener("keydown", handleInputNavigation);
  return input;
}

function normalizeInput(input) {
  const row = input.dataset.row;
  const index = Number(input.dataset.dayIndex);
  const wasDismissedCell = row === "day" && normalizeCode(input.dataset.prevValue ?? input.value) === "УВ";
  const actual = parseActual(input.value, row);

  if (wasDismissedCell && !(actual.kind === "code" && actual.value === "УВ")) {
    clearDismissalTail(index);
  }

  if (actual.kind === "code") {
    input.value = actual.value;
    if (row === "day") {
      nightInputs[index].value = "";
      if (actual.value === "УВ") {
        fillDismissalTail(index + 1);
      }
    }
  } else if (actual.kind === "number") {
    input.value = formatInputValue(actual.value);
  } else if (actual.kind === "blank") {
    input.value = "";
  } else {
    input.value = normalizeLetters(input.value);
  }

  applyInputLocks();
  renderMarks();
  input.dataset.prevValue = input.value ?? "";
}

function clearDismissalTail(startIndex) {
  for (let i = startIndex; i < DAYS.length; i += 1) {
    if (normalizeCode(dayInputs[i]?.value) !== "УВ") continue;
    dayInputs[i].value = "";
    nightInputs[i].value = "";
    marks[i] = null;
  }
}

function fillDismissalTail(startIndex) {
  for (let i = startIndex; i < DAYS.length; i += 1) {
    dayInputs[i].value = "УВ";
    nightInputs[i].value = "";
    marks[i] = null;
  }
}

function handleInputNavigation(event) {
  if (!event.key.startsWith("Arrow")) return;

  const input = event.currentTarget;
  const row = input.dataset.row;
  const index = Number(input.dataset.dayIndex);
  let target = null;

  if (event.key === "ArrowLeft" && index > 0) target = row === "day" ? dayInputs[index - 1] : nightInputs[index - 1];
  if (event.key === "ArrowRight" && index < DAYS.length - 1) target = row === "day" ? dayInputs[index + 1] : nightInputs[index + 1];
  if (event.key === "ArrowUp" && row === "night") target = dayInputs[index];
  if (event.key === "ArrowDown" && row === "day") target = nightInputs[index];

  if (!target || target.disabled) return;
  event.preventDefault();
  target.focus();
  target.select();
}

function getDismissalIndex() {
  return dayInputs.findIndex((input) => normalizeCode(input.value) === "УВ");
}

function applyInputLocks() {
  const dismissalIndex = getDismissalIndex();

  DAYS.forEach((_, index) => {
    const afterDismissal = dismissalIndex >= 0 && index > dismissalIndex;
    const dayCode = normalizeCode(dayInputs[index]?.value);
    dayInputs[index].disabled = afterDismissal;
    nightInputs[index].disabled = afterDismissal || Boolean(dayCode);
  });

  const selectedLocked = dismissalIndex >= 0 && selectedDayIndex > dismissalIndex;
  for (const button of elements.markButtons) button.disabled = selectedLocked;
}

function setSelectedDay(index) {
  selectedDayIndex = Math.min(DAYS.length - 1, Math.max(0, Number(index) || 0));
  const day = DAYS[selectedDayIndex];
  elements.selectedDayLabel.textContent = `${day.full}, ${day.date} число`;

  headerCells.forEach((cell, cellIndex) => {
    cell.classList.toggle("is-selected", cellIndex === selectedDayIndex);
  });

  for (const button of elements.markButtons) {
    button.setAttribute("aria-pressed", String(marks[selectedDayIndex] === button.dataset.mark));
  }
  applyInputLocks();
}

function renderMarks() {
  DAYS.forEach((_, index) => {
    const classTargets = [headerCells[index], dayInputs[index]?.closest("td"), nightInputs[index]?.closest("td")].filter(Boolean);
    for (const target of classTargets) {
      target.classList.remove("mark-holiday", "mark-transferred", "mark-short");
      if (marks[index]) target.classList.add(`mark-${marks[index]}`);
    }

    const badge = headerCells[index]?.querySelector(".mark-badge");
    if (badge) badge.textContent = MARK_LABELS[marks[index]] || "";
  });
  setSelectedDay(selectedDayIndex);
}

function clearEvaluation() {
  document.querySelectorAll(".training-table .is-error, .training-table .is-correct").forEach((element) => {
    element.classList.remove("is-error", "is-correct");
  });
}

function setFeedback(message, tone = "neutral", details = []) {
  elements.feedback.replaceChildren();

  const summary = document.createElement("div");
  summary.className = "font-semibold";
  summary.textContent = message;
  elements.feedback.appendChild(summary);

  if (details.length) {
    const list = document.createElement("ul");
    list.className = "feedback-details";
    for (const detail of details) {
      const item = document.createElement("li");
      item.textContent = detail;
      list.appendChild(item);
    }
    elements.feedback.appendChild(list);
  }

  elements.feedback.classList.remove("is-error", "is-success");
  if (tone === "error") elements.feedback.classList.add("is-error");
  if (tone === "success") elements.feedback.classList.add("is-success");
}

function describeActual(actual) {
  if (actual.kind === "blank") return "ячейка оставлена пустой";
  if (actual.kind === "invalid") return `введено непонятное значение «${actual.value}»`;
  if (actual.kind === "code") return `указан код ${actual.value}`;
  return `указано ${formatHours(actual.value)} часа`;
}

function explainNumericExpectation(index, row, expected, expectedWeek) {
  const mode = currentMode();
  const pairedDay = expectedWeek.day[index];
  const pairedNight = expectedWeek.night[index];

  if (row === "День" && expected === 2 && pairedNight === 2) {
    return "Это начало ночной смены: в строках «День» и «Ночь» ставится 2/2.";
  }
  if (row === "Ночь" && expected === 2 && pairedDay === 2) {
    return "При выходе в ночь ночная часть первой даты равна 2 часам.";
  }
  if (row === "День" && expected === mode.nightCloseDay && pairedNight === 5) {
    return `Ночная смена заканчивается на следующую дату сочетанием ${formatHours(mode.nightCloseDay)}/5.`;
  }
  if (row === "Ночь" && expected === 5 && pairedDay === mode.nightCloseDay) {
    return `Это окончание ночной смены: правильная связка — ${formatHours(mode.nightCloseDay)}/5.`;
  }
  if (row === "День" && expected === mode.continuousNightDay && pairedNight === 7) {
    return `При переходе из ночи в ночь используется сочетание ${formatHours(mode.continuousNightDay)}/7.`;
  }
  if (row === "Ночь" && expected === 7 && pairedDay === mode.continuousNightDay) {
    return `При переходе из ночи в ночь используется сочетание ${formatHours(mode.continuousNightDay)}/7.`;
  }
  if (row === "День" && expected === mode.regularDay) {
    return `Смена с 8:00 до 17:00 записывается как ${formatHours(mode.regularDay)} часа в строке «День».`;
  }
  if (row === "День" && expected === mode.longDay) {
    return `Смена с 8:00 до 20:00 записывается как ${formatHours(mode.longDay)} часа в строке «День».`;
  }
  if (row === "День" && expected === mode.shortDay) {
    return `В сокращённый рабочий день нужно указать ${formatHours(mode.shortDay)} часа.`;
  }
  return `В строке «${row}» должно быть ${formatHours(expected)}.`;
}

function explainCellError({ day, index, row, actual, expected, expectedWeek }) {
  const location = `${day.full}, строка «${row}»`;

  if (expected == null || expected === "") {
    return `${location}: здесь должно быть пусто, но ${describeActual(actual)}.`;
  }

  if (isCodeValue(expected)) {
    const meaning = CODE_LABELS[expected] || "нужный код отсутствия";
    return `${location}: по условию нужен код ${expected} — ${meaning}; сейчас ${describeActual(actual)}.`;
  }

  return `${location}: ${explainNumericExpectation(index, row, expected, expectedWeek)} Сейчас ${describeActual(actual)}.`;
}

function explainMarkError(day, actualMark, expectedMark) {
  if (!expectedMark) {
    return `${day.full}: календарная отметка не требуется, уберите «${MARK_NAMES[actualMark] || actualMark}».`;
  }
  if (!actualMark) {
    return `${day.full}: выберите этот день и отметьте его как «${MARK_NAMES[expectedMark]}».`;
  }
  return `${day.full}: вместо «${MARK_NAMES[actualMark]}» нужна отметка «${MARK_NAMES[expectedMark]}».`;
}

function renderLessonReference(lesson) {
  const items = Array.isArray(lesson.reference) ? lesson.reference : [];
  elements.lessonReference.classList.toggle("hidden", items.length === 0);
  elements.lessonReferenceList.replaceChildren();
  if (!items.length) return;

  elements.lessonReferenceTitle.textContent = lesson.id === "employment-codes"
    ? "Служебные коды"
    : "Шпаргалка по кодам отсутствий";

  for (const [code, description] of items) {
    const item = document.createElement("div");
    item.className = "flex min-w-0 items-start gap-2 rounded-xl bg-slate-950/35 px-3 py-2 ring-1 ring-white/10";

    const codeElement = document.createElement("span");
    codeElement.className = "shrink-0 rounded-lg bg-indigo-500/15 px-2 py-1 font-extrabold text-indigo-100 ring-1 ring-indigo-400/20";
    codeElement.textContent = code;

    const descriptionElement = document.createElement("span");
    descriptionElement.className = "min-w-0 pt-1 leading-5 text-slate-300";
    descriptionElement.textContent = description;

    item.append(codeElement, descriptionElement);
    elements.lessonReferenceList.appendChild(item);
  }
}

function validateCurrentExercise() {
  const lesson = currentLesson();
  if (lesson.type !== "exercise") return false;

  attempts += 1;
  clearEvaluation();
  dayInputs.forEach(normalizeInput);
  nightInputs.forEach(normalizeInput);

  const expected = getExpectedWeek(lesson);
  const errors = [];
  let requiredChecks = 0;
  let correctRequiredChecks = 0;
  let unexpectedValues = 0;

  DAYS.forEach((day, index) => {
    const rowChecks = [
      { row: "День", input: dayInputs[index], expected: expected.day[index] },
      { row: "Ночь", input: nightInputs[index], expected: expected.night[index] },
    ];
    const dayActualForTotal = parseActual(dayInputs[index].value, "day");
    const nightActualForTotal = parseActual(nightInputs[index].value, "night");
    if (
      dayActualForTotal.kind === "number"
      && nightActualForTotal.kind === "number"
      && dayActualForTotal.value + nightActualForTotal.value > 24
    ) {
      dayInputs[index].closest("td")?.classList.add("is-error");
      nightInputs[index].closest("td")?.classList.add("is-error");
      errors.push(`${day.full}: в сутки нельзя ставить больше 24 часов.`);
    }

    for (const check of rowChecks) {
      const actual = parseActual(check.input.value, check.input.dataset.row);
      const matches = valuesMatch(actual, check.expected);
      const cell = check.input.closest("td");
      const meaningful = check.expected != null || actual.kind !== "blank";
      const required = check.expected != null && check.expected !== "";
      if (required) requiredChecks += 1;
      if (matches) {
        if (required) correctRequiredChecks += 1;
        if (meaningful) cell.classList.add("is-correct");
      } else {
        if (!required && actual.kind !== "blank") unexpectedValues += 1;
        cell.classList.add("is-error");
        errors.push(explainCellError({
          day,
          index,
          row: check.row,
          actual,
          expected: check.expected,
          expectedWeek: expected,
        }));
      }
    }

    const actualMark = marks[index] || null;
    const expectedMark = expected.marks[index] || null;
    if (expectedMark) requiredChecks += 1;
    if (actualMark === expectedMark) {
      if (expectedMark) correctRequiredChecks += 1;
      if (expectedMark) headerCells[index].classList.add("is-correct");
    } else {
      if (!expectedMark && actualMark) unexpectedValues += 1;
      headerCells[index].classList.add("is-error");
      errors.push(explainMarkError(day, actualMark, expectedMark));
    }
  });

  const examScore = lesson.isExam
    ? Math.max(0, Math.round(((correctRequiredChecks - unexpectedValues) / Math.max(1, requiredChecks)) * 100))
    : null;

  if (!errors.length) {
    lastExamScore = lesson.isExam ? 100 : lastExamScore;
    setFeedback(
      lesson.isExam ? "Экзамен сдан на 100%. Ни одной ошибки." : "Всё заполнено правильно.",
      "success"
    );
    completeCurrentLesson();
    return true;
  }

  const visibleErrors = errors.slice(0, 5);
  if (errors.length > visibleErrors.length) {
    visibleErrors.push(`Осталось ещё ошибок: ${errors.length - visibleErrors.length}.`);
  }

  if (lesson.isExam) {
    lastExamScore = examScore;
    rememberTrainingProgress();
    setFeedback(`Результат экзамена: ${examScore}%. Разберитесь с отмеченными местами и попробуйте ещё раз.`, "error", visibleErrors);
    return false;
  }

  const lessonHint = attempts === 1 ? resolveLessonText(lesson.hint) : "";
  const summary = lessonHint
    ? `Нашлось ошибок: ${errors.length}. ${lessonHint}`
    : `Осталось ошибок: ${errors.length}. Проверьте объяснения ниже.`;
  setFeedback(summary, "error", visibleErrors);
  return false;
}

function completeCurrentLesson() {
  const lesson = currentLesson();
  completedLessons.add(lesson.id);
  rememberTrainingProgress();
  elements.lessonStatus.classList.remove("hidden");
  updateProgressUi();
  renderLessonStrip();

  const isLast = lessonIndex === LESSONS.length - 1;
  elements.successMessage.textContent = isLast ? "Все уроки пройдены." : "Переходим к следующему уроку…";
  elements.successOverlay.classList.add("is-visible");
  elements.successOverlay.setAttribute("aria-hidden", "false");

  window.clearTimeout(autoAdvanceTimer);
  autoAdvanceTimer = window.setTimeout(() => {
    elements.successOverlay.classList.remove("is-visible");
    elements.successOverlay.setAttribute("aria-hidden", "true");

    if (isLast) {
      courseFinished = true;
      saveProgress();
      renderCompletion();
    } else {
      goToLesson(lessonIndex + 1);
    }
  }, AUTO_ADVANCE_MS);

  saveProgress();
}

function updateProgressUi() {
  const completeCount = completedLessons.size;
  const percent = Math.round((completeCount / LESSONS.length) * 100);
  elements.progressText.textContent = `Пройдено: ${completeCount} из ${LESSONS.length}`;
  elements.progressBar.style.width = `${percent}%`;
  elements.stepCounter.textContent = courseFinished
    ? "Все уроки пройдены"
    : `Шаг ${lessonIndex + 1} из ${LESSONS.length}`;
}

function renderTopicMap(container, masteredLessons = completedLessons) {
  if (!container) return;
  container.replaceChildren();

  for (const topic of TRAINING_TOPICS) {
    const mastered = topic.lessons.every((lessonId) => masteredLessons.has(lessonId));
    if (!mastered) continue;

    const item = document.createElement("div");
    item.className = "topic-map-item";
    item.textContent = topic.label;
    container.appendChild(item);
  }
}

function renderLessonStrip() {
  elements.lessonStrip.replaceChildren();

  LESSONS.forEach((lesson, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "lesson-tab";
    if (!courseFinished && index === lessonIndex) button.classList.add("is-active");
    if (completedLessons.has(lesson.id)) button.classList.add("is-complete");
    button.setAttribute("aria-current", !courseFinished && index === lessonIndex ? "step" : "false");

    const number = document.createElement("span");
    number.className = "lesson-tab-number";
    number.textContent = completedLessons.has(lesson.id) ? `Шаг ${index + 1} · пройдено` : `Шаг ${index + 1}`;

    const title = document.createElement("span");
    title.className = "lesson-tab-title";
    title.textContent = lesson.shortTitle;

    button.append(number, title);
    button.addEventListener("click", () => goToLesson(index));
    elements.lessonStrip.appendChild(button);
  });
}

function renderLesson() {
  courseFinished = false;
  attempts = 0;
  const lesson = currentLesson();

  elements.lessonArea.classList.remove("hidden");
  elements.completion.classList.add("hidden");
  elements.lessonKind.textContent = lesson.isExam
    ? "Экзамен без подсказок"
    : lesson.type === "theory"
      ? "Теория"
      : "Практическое задание";
  elements.lessonTitle.textContent = lesson.title;
  const lessonDescription = resolveLessonDescription(lesson);
  elements.lessonDescription.textContent = lessonDescription;
  elements.lessonStatus.classList.toggle("hidden", !completedLessons.has(lesson.id));
  elements.theoryPanel.classList.toggle("hidden", lesson.type !== "theory");
  elements.exercisePanel.classList.toggle("hidden", lesson.type !== "exercise");
  elements.resetLesson.classList.toggle("hidden", lesson.type !== "exercise");
  elements.primary.textContent = lesson.type === "theory"
    ? "Начать практику"
    : lesson.isExam
      ? "Сдать экзамен"
      : "Проверить";
  elements.previous.disabled = lessonIndex === 0;
  elements.newExam.classList.toggle("hidden", !lesson.isExam);

  if (lesson.type === "theory") {
    renderLessonReference(lesson);
    renderTheory();
    setFeedback("Сравните примеры. Переключите режим нормы, если хотите увидеть женские значения.");
  } else {
    renderLessonReference(lesson);
    buildTrainingTable();
    setFeedback(
      lesson.isExam
        ? "Подсказки отключены. Заполните неделю по условию и сдайте экзамен."
        : `Задание: ${lessonDescription}`
    );
  }

  updateModeUi();
  updateProgressUi();
  renderLessonStrip();
  saveProgress();
}

function renderCompletion() {
  courseFinished = true;
  rememberTrainingCompletion();
  rememberTrainingProgress();
  elements.lessonArea.classList.add("hidden");
  elements.completion.classList.remove("hidden");
  renderTopicMap(elements.completionTopics);
  elements.completionExamResult.textContent = "Экзамен: 100%";
  updateProgressUi();
  renderLessonStrip();
  saveProgress();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function goToLesson(index) {
  window.clearTimeout(autoAdvanceTimer);
  elements.successOverlay.classList.remove("is-visible");
  elements.successOverlay.setAttribute("aria-hidden", "true");
  lessonIndex = Math.min(LESSONS.length - 1, Math.max(0, Number(index) || 0));
  courseFinished = false;
  renderLesson();
  document.getElementById("lessonArea")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetCurrentLesson() {
  if (currentLesson().type !== "exercise") return;
  attempts = 0;
  buildTrainingTable();
  const lesson = currentLesson();
  setFeedback(
    lesson.isExam
      ? "Экзаменационный бланк очищен. Условие осталось прежним."
      : `Задание очищено. ${resolveLessonDescription(lesson)}`
  );
}

function chooseNewExamScenario() {
  if (!currentLesson().isExam) return;

  const alternatives = EXAM_SCENARIOS.filter((scenario) => scenario.id !== activeExamScenario?.id);
  activeExamScenario = alternatives[Math.floor(Math.random() * alternatives.length)] || pickExamScenario();
  lastExamScore = null;
  attempts = 0;
  elements.lessonDescription.textContent = activeExamScenario.description;
  buildTrainingTable();
  setFeedback("Новое экзаменационное задание готово. Подсказки отключены.");
}

function updateModeUi() {
  for (const button of elements.modeButtons) {
    button.classList.toggle("is-active", button.dataset.mode === modeKey);
  }

  elements.modeHint.textContent = modeKey === "female"
    ? "Женская норма применяется только для CHATEAU ALVISA: 7,2 часа в обычный день."
    : "Стандартная 40-часовая неделя: 8 часов в обычный рабочий день.";
}

async function resetAllProgress() {
  const confirmed = await confirmDialog({
    title: "Сбросить обучение?",
    message: "Все пройденные шаги будут отмечены как непройденные.",
    confirmText: "Сбросить",
    cancelText: "Оставить",
    tone: "warning",
  });
  if (!confirmed) return;

  completedLessons = new Set();
  lessonIndex = 0;
  courseFinished = false;
  activeExamScenario = null;
  lastExamScore = null;
  localStorage.removeItem(PROGRESS_KEY);
  renderLesson();
}

async function personalizeModeFromProfile() {
  try {
    const profile = await getMyProfile();
    if (modeTouched || userStartedExercise) return;

    const shouldUseFemale = isFemaleChateauProfile(profile);
    const nextMode = shouldUseFemale ? "female" : "standard";
    modeKey = nextMode;
    if (courseFinished) {
      updateModeUi();
    } else {
      renderLesson();
    }
    elements.modeHint.textContent = shouldUseFemale
      ? "По вашему профилю применяется женская норма CHATEAU ALVISA. Задания, подсказки и проверка часов уже пересчитаны."
      : "По вашему профилю применяется стандартная 40-часовая рабочая неделя.";
  } catch {
    // Тренажёр остаётся полностью рабочим без сессии или соединения с Supabase.
  }
}

function bindEvents() {
  for (const button of elements.modeButtons) {
    button.addEventListener("click", () => {
      const nextMode = button.dataset.mode;
      if (!MODES[nextMode] || nextMode === modeKey) return;
      modeTouched = true;
      modeKey = nextMode;
      renderLesson();
    });
  }

  for (const button of elements.markButtons) {
    button.addEventListener("click", () => {
      userStartedExercise = true;
      const mark = button.dataset.mark;
      marks[selectedDayIndex] = marks[selectedDayIndex] === mark ? null : mark;
      clearEvaluation();
      renderMarks();
      setFeedback("Отметка дня изменена. Нажмите «Проверить», когда закончите.");
    });
  }

  elements.primary.addEventListener("click", () => {
    if (currentLesson().type === "theory") {
      completedLessons.add(currentLesson().id);
      rememberTrainingProgress();
      updateProgressUi();
      saveProgress();
      goToLesson(1);
      return;
    }
    validateCurrentExercise();
  });

  elements.previous.addEventListener("click", () => goToLesson(lessonIndex - 1));
  elements.resetLesson.addEventListener("click", resetCurrentLesson);
  elements.newExam.addEventListener("click", chooseNewExamScenario);
  elements.resetProgress.addEventListener("click", () => void resetAllProgress());
  elements.restart.addEventListener("click", () => {
    completedLessons = new Set();
    lessonIndex = 0;
    courseFinished = false;
    activeExamScenario = null;
    lastExamScore = null;
    localStorage.removeItem(PROGRESS_KEY);
    renderLesson();
  });
}

readProgress();
bindEvents();
updateModeUi();
renderLessonStrip();
if (courseFinished) renderCompletion();
else renderLesson();
void personalizeModeFromProfile();
void resolveTrainingUser();
