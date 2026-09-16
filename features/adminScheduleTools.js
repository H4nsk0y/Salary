import { SHIFT_CYCLES, planCoveredShiftCycle } from "./shiftCycles.js";
import { planEightHourTemplate, planTeamNormFills, planTeamOvertimeReductions } from "./scheduleTools.js";

const TITLES = {
  dayNight48: "День / ночь / 48",
  twoDaysTwoNights48: "2 дня / 2 ночи / 48",
  fiveTwo: "5/2 по 8 часов",
  alternating: "Чередование 8 / 6+2",
  fillNorm: "Добить до нормы",
  reduceOvertime: "Сократить переработку",
};

function daysForState(state) {
  return state.dayHours.map((dayHours, index) => ({
    dayHours,
    nightHours: state.nightHours[index],
    leaveType: state.leaveType[index],
    comment: state.shiftComments[index],
    locked: Boolean(state.dayInputs[index]?.disabled || state.dismissedBeforeMonth),
  }));
}

function daysForPayload(payload) {
  if (!Array.isArray(payload?.dayHours) || !Array.isArray(payload?.nightHours) ||
      payload.dayHours.length !== payload.nightHours.length) return null;
  return payload.dayHours.map((dayHours, index) => ({
    dayHours,
    nightHours: payload.nightHours[index],
    leaveType: payload.leaveType?.[index],
    comment: payload.shiftComments?.[index],
  }));
}

function periodKey(context, signature) {
  return `${context.year}-${context.month}:${signature()}`;
}

function addTextItem(list, text) {
  const item = document.createElement("li");
  item.textContent = text;
  list.appendChild(item);
}

function workedHours(state) {
  return state.dayHours.reduce((total, hours, index) =>
    total + Number(hours || 0) + Number(state.nightHours[index] || 0), 0);
}

const hourText = (hours) => `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(hours)} ч`;

export function selectedHoursLabel(tool, state, norm) {
  const difference = workedHours(state) - norm;
  if (tool === "fillNorm") return difference < 0 ? `Не хватает ${hourText(-difference)}` : "Норма выполнена";
  if (tool === "reduceOvertime") return difference > 0 ? `Переработка ${hourText(difference)}` : "Без переработки";
  return "";
}

function shiftText(shift) {
  const day = Number(shift?.dayHours || 0);
  const night = Number(shift?.nightHours || 0);
  if (!day && !night) return "выходной";
  return night ? `${day}/${night} ч` : hourText(day);
}

export function formatScheduleChangeReport(state, changes, norm) {
  const after = workedHours(state) + changes.reduce((total, change) =>
    total + Number(change.to.dayHours || 0) + Number(change.to.nightHours || 0) -
      Number(change.from.dayHours || 0) - Number(change.from.nightHours || 0), 0);
  const dates = changes.map(({ index, from, to }) => `${index + 1}: ${shiftText(from)} → ${shiftText(to)}`);
  return `${state.name} — изменено смен: ${changes.length}${dates.length ? `; ${dates.join("; ")}` : ""}; после: ${hourText(after)}; норма: ${hourText(norm)}`;
}

export function initAdminScheduleTools({ getContext, loadPrevious, signature, applyChanges, isOwner, leaderId }) {
  const buttons = document.getElementById("scheduleToolButtons");
  const modal = document.getElementById("scheduleToolsModal");
  const people = document.getElementById("scheduleToolsPeople");
  const summary = document.getElementById("scheduleToolsSummary");
  const previewButton = document.getElementById("scheduleToolsPreview");
  const applyButton = document.getElementById("scheduleToolsApply");
  const closeButton = document.getElementById("scheduleToolsClose");
  if (!buttons || !modal || !people || !summary || !previewButton || !applyButton) return;

  document.body.appendChild(modal);

  buttons.classList.remove("hidden");
  const labLink = document.getElementById("scheduleLabLink");
  labLink?.classList.toggle("hidden", !isOwner);

  let activeTool = null;
  let pending = null;
  let operation = 0;
  let returnFocus = null;

  function close() {
    operation++;
    pending = null;
    modal.classList.add("hidden");
    applyButton.disabled = true;
    returnFocus?.focus();
  }

  function open(tool, trigger) {
    const context = getContext();
    if (!context?.teamStates?.length) return;
    activeTool = tool;
    pending = null;
    operation++;
    returnFocus = trigger;
    document.getElementById("scheduleToolsTitle").textContent = TITLES[tool];
    document.getElementById("scheduleToolsNote").textContent =
      "Выберите операторов. Фазы распределяются автоматически. Их заполненные дни не заменяются; рабочие смены руководителя приводятся к 5/2.";
    summary.textContent = "";
    applyButton.disabled = true;
    people.replaceChildren();

    for (const state of context.teamStates) {
      const row = document.createElement("label");
      row.className = "schedule-tools-person";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.userId = String(state.userId);
      checkbox.setAttribute("aria-label", `Выбрать ${state.name}`);
      const isLeader = String(state.userId) === String(leaderId);
      checkbox.checked = true;
      checkbox.disabled = isLeader;
      const name = document.createElement("span");
      name.textContent = `${state.name}${state.position ? ` · ${state.position}` : ""}${isLeader ? " · руководитель, 5/2" : ""}`;
      const deficit = document.createElement("span");
      deficit.className = "schedule-tools-deficit";
      if (!isLeader) deficit.textContent = selectedHoursLabel(tool, state, context.personalNorm(state));
      const updateDeficit = () => {
        deficit.hidden = !deficit.textContent || !checkbox.checked || isLeader;
      };
      checkbox.addEventListener("change", () => {
        operation++; pending = null; applyButton.disabled = true;
        updateDeficit();
      });
      row.append(checkbox, name, deficit);
      updateDeficit();
      people.appendChild(row);
    }
    modal.classList.remove("hidden");
    closeButton.focus();
  }

  async function preview() {
    const request = ++operation;
    const context = getContext();
    const baseline = periodKey(context, signature);
    const rows = Array.from(people.querySelectorAll(".schedule-tools-person"));
    const selected = rows.map((row) => ({
      id: row.querySelector("input").dataset.userId,
      checked: row.querySelector("input").checked,
    }));
    const chosen = selected.filter((row) => row.checked && row.id !== String(leaderId));
    pending = null;
    applyButton.disabled = true;
    if (!chosen.length && !leaderId) { summary.textContent = "Выберите хотя бы одного сотрудника."; return; }
    previewButton.disabled = true;
    summary.textContent = "Проверяю график…";

    try {
      const previous = new Map();
      if (SHIFT_CYCLES[activeTool] || activeTool === "fillNorm") {
        await Promise.all(chosen.map(async ({ id }) => {
          previous.set(id, daysForPayload(await loadPrevious(id, context.year, context.month)));
        }));
      }
      if (request !== operation || modal.classList.contains("hidden")) return;
      if (periodKey(getContext(), signature) !== baseline) {
        summary.textContent = "Табель изменился. Постройте предпросмотр заново.";
        return;
      }

      const result = [];
      const errors = [];
      const lines = [];
      const teamMembers = context.teamStates.map((state) => {
        const id = String(state.userId);
        const selection = selected.find((row) => row.id === id);
        return { id, days: daysForState(state), norm: context.personalNorm(state),
          selected: Boolean(selection?.checked) && id !== String(leaderId), excluded: id === String(leaderId),
          previousDay: previous.get(id)?.at(-1) };
      });
      const teamPlans = new Map((activeTool === "fillNorm" ? planTeamNormFills(teamMembers, context) :
        activeTool === "reduceOvertime" ? planTeamOvertimeReductions(teamMembers) : [])
        .map(({ id, plan }) => [id, plan]));
      let cyclePlans = new Map();
      if (SHIFT_CYCLES[activeTool]) {
        const coverage = planCoveredShiftCycle({ cycleId: activeTool, year: context.year, month: context.month,
          members: teamMembers.filter((member) => member.selected).map((member) => ({
            ...member, previousDays: previous.get(member.id),
          })) });
        if (coverage.error) errors.push(coverage.error);
        if (coverage.gaps.length) errors.push(`Не закрыты смены: ${coverage.gaps.slice(0, 12).map(({ index, kind }) =>
          `${index + 1} ${kind === "day" ? "день" : "ночь"}`).join(", ")}${coverage.gaps.length > 12 ? "…" : ""}.`);
        cyclePlans = new Map(coverage.plans.map(({ id, plan }) => [id, plan]));
      }

      for (const [order, { id }] of chosen.entries()) {
        const state = context.teamStates.find((person) => String(person.userId) === id);
        if (!state) continue;
        const existingDays = daysForState(state);
        let plan;
        if (SHIFT_CYCLES[activeTool]) {
          plan = cyclePlans.get(id);
          if (!plan) continue;
        } else if (activeTool === "fiveTwo" || activeTool === "alternating") {
          plan = planEightHourTemplate({ mode: activeTool, year: context.year, month: context.month, existingDays,
            holiday: context.holiday, transferredOff: context.transferredOff, group: order % 2 });
        } else if (activeTool === "fillNorm") {
          plan = teamPlans.get(id);
          if (plan.shortage) errors.push(`${state.name}: недостаточно свободных дней для добавления смен.`);
        } else {
          plan = teamPlans.get(id);
        }
        result.push({ state, changes: plan.changes });
        if (activeTool === "fillNorm" || activeTool === "reduceOvertime") {
          if (plan.changes.length) lines.push(formatScheduleChangeReport(state, plan.changes, context.personalNorm(state)));
        }
      }

      const leaderState = context.teamStates.find((state) => String(state.userId) === String(leaderId));
      if (leaderState) {
        const plan = planEightHourTemplate({ mode: "fiveTwo", year: context.year, month: context.month,
          existingDays: daysForState(leaderState), holiday: context.holiday,
          transferredOff: context.transferredOff, replaceWorked: true });
        result.push({ state: leaderState, changes: plan.changes });
        if (activeTool === "fillNorm" || activeTool === "reduceOvertime") {
          if (plan.changes.length) lines.push(formatScheduleChangeReport(leaderState, plan.changes, context.personalNorm(leaderState)));
        }
      }

      summary.replaceChildren();
      const intro = document.createElement("div");
      const count = result.reduce((sum, item) => sum + item.changes.length, 0);
      intro.textContent = `Изменений: ${count}.${SHIFT_CYCLES[activeTool] ? " Проверьте покрытие смен перед применением." : ""}`;
      summary.appendChild(intro);
      if (errors.length || lines.length) {
        const list = document.createElement("ul");
        for (const line of [...errors, ...lines]) addTextItem(list, line);
        summary.appendChild(list);
      }
      if (errors.length || !count) return;
      pending = { baseline, result, tool: activeTool };
      applyButton.disabled = false;
    } catch (error) {
      summary.textContent = error?.message || "Не удалось построить предпросмотр.";
    } finally {
      previewButton.disabled = false;
    }
  }

  function apply() {
    if (!pending || periodKey(getContext(), signature) !== pending.baseline) {
      pending = null;
      applyButton.disabled = true;
      summary.textContent = "Табель изменился. Постройте предпросмотр заново.";
      return;
    }
    const applied = pending;
    pending = null;
    applyButton.disabled = true;
    applyChanges(applied.result, applied.tool);
    if (applied.tool === "fillNorm" || applied.tool === "reduceOvertime") {
      summary.prepend(document.createTextNode("Изменения применены и сохраняются. "));
    } else {
      close();
    }
  }

  buttons.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-schedule-tool]");
    if (trigger) open(trigger.dataset.scheduleTool, trigger);
  });
  document.getElementById("scheduleToolsSelectAll")?.addEventListener("click", () => {
    people.querySelectorAll(".schedule-tools-person").forEach((row) => {
      row.querySelector("input").checked = true;
      const deficit = row.querySelector(".schedule-tools-deficit");
      deficit.hidden = !deficit.textContent || row.querySelector("input").disabled;
    });
    operation++;
    pending = null;
    applyButton.disabled = true;
  });
  document.getElementById("scheduleToolsSelectNone")?.addEventListener("click", () => {
    people.querySelectorAll("input:not(:disabled)").forEach((input) => { input.checked = false; });
    people.querySelectorAll(".schedule-tools-deficit").forEach((deficit) => { deficit.hidden = true; });
    operation++;
    pending = null;
    applyButton.disabled = true;
  });
  previewButton.addEventListener("click", preview);
  applyButton.addEventListener("click", apply);
  closeButton.addEventListener("click", close);
  modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.classList.contains("hidden")) close();
  });
}
