import { requireSession } from "../auth.js";
import { getMyProfile } from "../db.js";
import { getProductionCalendarMonth } from "../productionCalendar.js";
import { SHIFT_CYCLES, planCoveredShiftCycle } from "./shiftCycles.js";
import { planEightHourTemplate, planTeamNormFills, planTeamOvertimeReductions } from "./scheduleTools.js";
import { planBottlingSchedule } from "./bottlingSchedule.js";

const monthNames = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const monthSelect = document.getElementById("labMonth");
const yearInput = document.getElementById("labYear");
const countInput = document.getElementById("labCount");
const branchSelect = document.getElementById("labBranch");
const actions = document.getElementById("labActions");
const header = document.getElementById("labHeader");
const body = document.getElementById("labBody");
const status = document.getElementById("labStatus");
const previewList = document.getElementById("labPreviewList");
const applyButton = document.getElementById("labApply");

let year = new Date().getFullYear();
let month = new Date().getMonth();
let people = [];
let calendar = null;
let activeTool = null;
let pending = null;
let calendarRequest = 0;

function dayCount() { return new Date(year, month + 1, 0).getDate(); }
function blankDays() { return Array.from({ length: dayCount() }, () => ({ dayHours: 0, nightHours: 0, leaveType: null })); }
function blankPerson(index) {
  return {
    id: index + 1,
    name: `Сотрудник-${index + 1}`,
    isLeader: false,
    noNight: false,
    norm: defaultNorm(),
    days: blankDays(),
  };
}
function defaultNorm() {
  let total = 0;
  for (let index = 0; index < dayCount(); index++) {
    const weekday = new Date(year, month, index + 1).getDay();
    if (weekday === 0 || weekday === 6 || calendar?.isHoliday?.[index] || calendar?.isTransferredOff?.[index]) continue;
    total += 8 - (calendar?.isShortDay?.[index] ? 1 : 0);
  }
  return total;
}
function worked(person) {
  return person.days.reduce((sum, day) => sum + day.dayHours + day.nightHours, 0);
}
function shiftText(day) {
  if (day.leaveType) return day.leaveType;
  return day.dayHours ? String(day.dayHours) : "";
}
function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle("lab-error", error);
}
function clearPreview() {
  pending = null;
  applyButton.disabled = true;
  previewList.replaceChildren();
}

function render() {
  clearPreview();
  header.replaceChildren();
  body.replaceChildren();
  const employeeHeader = document.createElement("th");
  employeeHeader.textContent = "Сотрудник";
  header.appendChild(employeeHeader);
  for (let index = 0; index < dayCount(); index++) {
    const th = document.createElement("th");
    th.textContent = String(index + 1);
    if ([0, 6].includes(new Date(year, month, index + 1).getDay())) th.classList.add("lab-weekend");
    if (calendar?.isHoliday?.[index]) th.classList.add("lab-holiday");
    header.appendChild(th);
  }
  const totalHeader = document.createElement("th");
  totalHeader.textContent = "Часы / норма";
  header.appendChild(totalHeader);

  for (const person of people) {
    const dayRow = document.createElement("tr");
    const nightRow = document.createElement("tr");
    nightRow.className = "lab-row-night";
    const nameCell = document.createElement("th");
    nameCell.rowSpan = 2;
    const personBox = document.createElement("div");
    personBox.className = "lab-person";
    const name = document.createElement("strong");
    name.textContent = person.name;
    const settings = document.createElement("div");
    const role = document.createElement("select");
    role.setAttribute("aria-label", `Роль ${person.name}`);
    for (const [value, label] of [["operator", "Оператор"], ["leader", "Руководитель"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      role.appendChild(option);
    }
    role.value = person.isLeader ? "leader" : "operator";
    role.addEventListener("change", () => {
      if (role.value === "leader" && people.some((item) => item !== person && item.isLeader)) {
        role.value = "operator";
        setStatus("В учебном отделе может быть только один руководитель.", true);
        return;
      }
      person.isLeader = role.value === "leader";
      person.days = blankDays();
      render();
      setStatus(person.isLeader
        ? "Учебная строка очищена: руководитель исключён из операторского графика и получит 5/2."
        : "Учебная строка очищена: сотрудник снова оператор.");
    });
    const norm = document.createElement("input");
    norm.type = "number";
    norm.min = "0";
    norm.max = "300";
    norm.step = "0.1";
    norm.value = String(person.norm);
    norm.setAttribute("aria-label", `Норма ${person.name}`);
    norm.addEventListener("change", () => {
      const value = Number(norm.value);
      if (!Number.isFinite(value) || value < 0 || value > 300) { norm.value = String(person.norm); return; }
      person.norm = value;
      clearPreview();
      updateTotals();
    });
    const nightMode = document.createElement("select");
    nightMode.setAttribute("aria-label", `Допуск к ночным сменам ${person.name}`);
    for (const [value, label] of [["allowed", "С ночами"], ["forbidden", "Только день"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      nightMode.appendChild(option);
    }
    nightMode.value = person.noNight ? "forbidden" : "allowed";
    nightMode.disabled = person.isLeader;
    nightMode.addEventListener("change", () => {
      person.noNight = nightMode.value === "forbidden";
      person.days = blankDays();
      render();
      setStatus(person.noNight
        ? "Учебная строка очищена: сотруднику будут назначаться только дневные смены."
        : "Учебная строка очищена: ночные смены снова разрешены.");
    });
    settings.append(role, nightMode, norm);
    personBox.append(name, settings);
    nameCell.appendChild(personBox);
    dayRow.appendChild(nameCell);

    for (let index = 0; index < dayCount(); index++) {
      for (const [row, field] of [[dayRow, "dayHours"], [nightRow, "nightHours"]]) {
        const td = document.createElement("td");
        if ([0, 6].includes(new Date(year, month, index + 1).getDay())) td.classList.add("lab-weekend");
        if (calendar?.isHoliday?.[index]) td.classList.add("lab-holiday");
        const input = document.createElement("input");
        input.type = "text";
        input.inputMode = field === "nightHours" ? "decimal" : "text";
        input.value = field === "dayHours" ? shiftText(person.days[index]) : (person.days[index].nightHours || "");
        input.disabled = field === "nightHours" && Boolean(person.days[index].leaveType);
        input.setAttribute("aria-label", `${person.name}, ${index + 1}, ${field === "dayHours" ? "день" : "ночь"}`);
        input.addEventListener("change", () => updateCell(person, index, field, input.value));
        td.appendChild(input);
        row.appendChild(td);
      }
    }
    const totalCell = document.createElement("td");
    totalCell.rowSpan = 2;
    totalCell.className = "lab-total";
    totalCell.dataset.totalId = String(person.id);
    dayRow.appendChild(totalCell);
    body.append(dayRow, nightRow);
  }
  updateTotals();
}

function updateTotals() {
  for (const person of people) {
    const cell = body.querySelector(`[data-total-id="${person.id}"]`);
    if (cell) cell.textContent = `${worked(person)} / ${person.norm}`;
  }
}

function updateCell(person, index, field, raw) {
  const next = { ...person.days[index] };
  const value = String(raw).trim().toUpperCase().replace(",", ".");
  if (field === "dayHours" && ["ОТ", "Б", "ОД", "У", "НТ", "УВ"].includes(value)) {
    next.dayHours = 0;
    next.nightHours = 0;
    next.leaveType = value;
  } else {
    const number = value === "" ? 0 : Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 24 || next[field === "dayHours" ? "nightHours" : "dayHours"] + number > 24) {
      setStatus("В сутках не может быть больше 24 часов. Введите число от 0 до 24 или код отсутствия в дневной ячейке.", true);
      render();
      return;
    }
    next[field] = number;
    if (field === "dayHours") next.leaveType = null;
    if (field === "nightHours" && next.leaveType) { render(); return; }
  }
  person.days[index] = next;
  clearPreview();
  render();
  setStatus("Учебный табель изменен.");
}

function buildPreview() {
  clearPreview();
  if (!activeTool) return;
  const result = [];
  let changeCount = 0;
  const members = people.map((person) => ({ id: person.id, days: person.days, norm: person.norm,
    noNight: person.noNight,
    selected: !person.isLeader, excluded: person.isLeader }));
  const teamPlans = new Map((activeTool === "fillNorm" ? planTeamNormFills(members, { year, month }) :
    activeTool === "reduceOvertime" ? planTeamOvertimeReductions(members) : [])
    .map(({ id, plan }) => [id, plan]));
  const coverage = SHIFT_CYCLES[activeTool]
    ? planCoveredShiftCycle({ cycleId: activeTool, year, month,
      members: people.map((person) => ({
        id: person.id, days: person.days, isLeader: person.isLeader, noNight: person.noNight,
      })) })
    : activeTool === "bottling" ? planBottlingSchedule({ year, month, holiday: calendar?.isHoliday,
      members: people.filter((person) => !person.isLeader).map((person) => ({
        id: person.id, name: person.name, days: person.days, norm: person.norm, noNight: person.noNight,
      })) }) : null;
  const cyclePlans = new Map((coverage?.plans ?? []).map(({ id, plan }) => [id, plan]));
  for (const [order, person] of people.entries()) {
    let plan;
    if (person.isLeader) {
      plan = planEightHourTemplate({ mode: "fiveTwo", year, month, existingDays: person.days,
        holiday: calendar?.isHoliday, transferredOff: calendar?.isTransferredOff,
        shortDay: calendar?.isShortDay, replaceWorked: true });
    } else if (SHIFT_CYCLES[activeTool] || activeTool === "bottling") {
      plan = cyclePlans.get(person.id);
      if (!plan) continue;
    } else if (activeTool === "fiveTwo" || activeTool === "alternating") {
      plan = planEightHourTemplate({ mode: activeTool, year, month, existingDays: person.days,
        holiday: calendar?.isHoliday, transferredOff: calendar?.isTransferredOff,
        group: order % 2, noNight: person.noNight });
    } else if (activeTool === "fillNorm") {
      plan = teamPlans.get(person.id);
    } else {
      plan = teamPlans.get(person.id);
    }
    result.push({ person, changes: plan.changes });
    changeCount += plan.changes.length;
    const line = document.createElement("li");
    line.textContent = `${person.name}${person.isLeader ? " (руководитель, 5/2)" : ""}: ${plan.changes.length} изм.${plan.conflicts?.length ? `, занято ${plan.conflicts.length}` : ""}${plan.shortage ? ", недостаточно свободных дней" : ""}${Number.isFinite(plan.after) ? `, ${plan.before} → ${plan.after} ч` : ""}`;
    previewList.appendChild(line);
  }
  const gapText = coverage?.gaps?.length ? `Не закрыты смены: ${coverage.gaps.slice(0, 10).map(({ index, kind }) =>
    `${index + 1} ${kind === "day" ? "день" : "ночь"}`).join(", ")}.` : "";
  pending = changeCount && !coverage?.error && !coverage?.gaps?.length ? result : null;
  applyButton.disabled = !pending;
  setStatus(coverage?.error || gapText || `Предпросмотр: ${changeCount} изменений. Занятые ячейки не заменяются.`,
    Boolean(coverage?.error || gapText));
}

async function loadCalendar() {
  const request = ++calendarRequest;
  setStatus("Загружаю календарь…");
  try {
    const result = await getProductionCalendarMonth(year, month, { branch: branchSelect.value || null });
    if (request !== calendarRequest) return;
    calendar = result;
    people = people.map((person) => ({ ...person, norm: defaultNorm() }));
    render();
    setStatus("Учебный табель готов.");
  } catch {
    if (request !== calendarRequest) return;
    calendar = null;
    render();
    setStatus("Календарь недоступен: показаны обычные выходные.", true);
  }
}

function resetMonth() {
  const count = Math.max(2, Math.min(30, Number(countInput.value) || 4));
  countInput.value = String(count);
  people = Array.from({ length: count }, (_, index) => blankPerson(index));
  render();
}

async function init() {
  try {
    await requireSession();
    const profile = await getMyProfile();
    if (profile?.role !== "owner") throw new Error("Not owner");
  } catch {
    document.getElementById("labDenied").hidden = false;
    return;
  }
  document.getElementById("labShell").hidden = false;
  monthNames.forEach((name, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = name;
    monthSelect.appendChild(option);
  });
  monthSelect.value = String(month);
  yearInput.value = String(year);
  resetMonth();
  await loadCalendar();
}

actions.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-tool]");
  if (!button) return;
  activeTool = button.dataset.tool;
  actions.querySelectorAll("button").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
  buildPreview();
});
applyButton.addEventListener("click", () => {
  if (!pending) return;
  for (const { person, changes } of pending) {
    for (const { index, to } of changes) {
      person.days[index] = { ...person.days[index], ...to };
    }
  }
  render();
  setStatus("Изменения применены только к учебному табелю.");
});
document.getElementById("labReset").addEventListener("click", () => { resetMonth(); setStatus("Учебный табель очищен."); });
countInput.addEventListener("change", () => {
  const count = Math.max(2, Math.min(30, Number(countInput.value) || 4));
  countInput.value = String(count);
  const next = Array.from({ length: count }, (_, index) => people[index] ?? blankPerson(index));
  people = next;
  render();
  setStatus("Число сотрудников изменено.");
});
for (const control of [monthSelect, yearInput, branchSelect]) control.addEventListener("change", async () => {
  const nextYear = Number(yearInput.value);
  if (!Number.isInteger(nextYear) || nextYear < 2000 || nextYear > 2100) { yearInput.value = String(year); return; }
  year = nextYear;
  month = Number(monthSelect.value);
  calendar = null;
  resetMonth();
  await loadCalendar();
});

void init();
