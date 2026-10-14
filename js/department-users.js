import { requireSession } from "./auth.js";
import { leaderListDepartmentUsers, leaderUpdateDepartmentUser, leaderSetDepartmentUserFlag, leaderGetUserTimesheet } from "./db.js";
import { POSITION_OPTIONS, BRANCH_OPTIONS } from "./features/employeeProfileOptions.js";
import { beginPageDataRequest, finishPageDataRequest } from "./pageLoader.js";
import { startPresenceHeartbeat } from "./presence.js";
import "./scrollbar.js";

const list = document.getElementById("departmentUsersList");
const search = document.getElementById("employeeSearch");
const errorBox = document.getElementById("departmentUsersError");
const dialog = document.getElementById("employeeDialog");
const body = document.getElementById("employeeDialogBody");
let users = [];
let requestVersion = 0;
const LEAVE_LABELS = { vacation: "ОТ", vac_paid: "ОТ", vac_unpaid: "ОД", vac_unpaid_required: "ОЗ", sick: "Б", edu_paid: "У", edu_unpaid: "УД", not_employed: "НТ", dismissed: "УВ" };
function element(tag, value = "", className = "") {
  const node = document.createElement(tag);
  node.textContent = value;
  node.className = className;
  return node;
}
function message(error) {
  const text = String(error?.message || error);
  if (/POSITION_CHANGE_LOCKED/.test(text)) return "Изменение должности запрещено овнером.";
  if (/DEPARTMENT_LEADER_POSITION_RESERVED/.test(text)) return "Эта должность закреплена за подтверждённым руководителем.";
  if (/ACCESS_DENIED|USER_NOT_IN_DEPARTMENT/.test(text)) return "Доступ закрыт. Нужна роль руководителя этого отдела.";
  if (/PGRST202|schema cache|could not find/i.test(text)) return "Серверная часть ещё не подключена: нужно применить SQL 071.";
  return text;
}
function showError(error) {
  errorBox.hidden = !error;
  errorBox.textContent = error ? message(error) : "";
}
async function load() {
  const data = await leaderListDepartmentUsers();
  users = data?.users ?? [];
  document.getElementById("departmentName").textContent = data.department_name || data.department_key;
  document.getElementById("departmentTableLink").href = `admin.html?department=${encodeURIComponent(data.department_key)}`;
  render();
}
function action(label, path, callback) {
  const button = element("button");
  button.type = "button";
  button.setAttribute("aria-label", label);
  // Lucide Pencil / CalendarDays icon geometry.
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
  button.addEventListener("click", callback);
  return button;
}
function render() {
  list.replaceChildren();
  const term = search.value.trim().toLocaleLowerCase("ru");
  const visible = users.filter((user) => `${user.display_name || ""} ${user.tab_number || ""}`.toLocaleLowerCase("ru").includes(term));
  document.getElementById("employeeCount").textContent = `${visible.length} / ${users.length}`;
  for (const user of visible) {
    const row = element("article", "", "department-user-row");
    const name = element("div", user.display_name || "Сотрудник", "department-user-name");
    name.append(element("div", new Map(POSITION_OPTIONS).get(user.position) || user.position || "Должность не указана", "department-user-meta"));
    const details = element("div", user.tab_number ? `Таб. № ${user.tab_number}` : "Без табельного номера", "department-user-details");
    const flags = [user.is_leader && "Руководитель", user.is_editor && "Редактор", user.no_night_shifts && "Без ночных смен"].filter(Boolean);
    details.append(element("div", flags.join(" · "), "department-user-meta"));
    const actions = element("div", "", "department-user-actions");
    actions.append(
      action("Редактировать профиль", '<path d="m16 3 5 5-13 13H3v-5L16 3Z"/><path d="m14 5 5 5"/>', () => edit(user)),
      action("Посмотреть табель", '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2"/>', () => viewTimesheet(user)),
    );
    row.append(name, details, actions);
    list.append(row);
  }
  if (!visible.length) list.append(element("p", "Сотрудники не найдены."));
}
function open(user, suffix) {
  requestVersion += 1;
  body.replaceChildren();
  document.getElementById("employeeDialogTitle").textContent = `${user.display_name || "Сотрудник"} · ${suffix}`;
  if (!dialog.open) dialog.showModal();
}
function confirmFlag(title, text) {
  return new Promise((resolve) => {
    const confirmation = element("dialog", "", "employee-dialog");
    confirmation.setAttribute("aria-label", title);
    const header = element("header"); header.append(element("h2", title));
    const content = element("div", "", "employee-confirm");
    const yes = element("button", "Подтвердить", "employee-save"); const no = element("button", "Отмена");
    const finish = (approved) => { confirmation.close(); confirmation.remove(); resolve(approved); };
    yes.addEventListener("click", () => finish(true)); no.addEventListener("click", () => finish(false));
    confirmation.addEventListener("cancel", (event) => { event.preventDefault(); finish(false); });
    const actions = element("div", "", "employee-confirm-actions"); actions.append(no, yes);
    content.append(element("p", text), actions); confirmation.append(header, content);
    document.body.append(confirmation); confirmation.showModal(); no.focus();
  });
}
function edit(user) {
  open(user, "Профиль");
  const form = element("form");
  const fields = element("div", "", "employee-fields");
  const inputs = new Map();
  for (const [key, title, options, type] of [
    ["position", user.position_locked ? "Должность · заблокирована овнером" : "Должность", POSITION_OPTIONS],
    ["tab_number", "Табельный номер", null, "text"],
    ["branch", "Филиал", BRANCH_OPTIONS],
    ["employment_date", "Дата трудоустройства", null, "date"],
    ["weekly_hours", "Норма недели", [["", "Не указана"], ["40", "40 часов"], ["35", "35 часов"]]],
    ["oklad", "Оклад, ₽", null, "number"],
  ]) {
    const label = element("label", title);
    const input = element(options ? "select" : "input");
    if (options) {
      for (const [value, caption] of options) { const option = element("option", caption); option.value = value; input.append(option); }
      if (user[key] != null && !options.some(([value]) => String(value) === String(user[key]))) {
        const option = element("option", String(user[key])); option.value = user[key]; input.append(option);
      }
    } else {
      input.type = type;
      if (type === "number") { input.min = "0"; input.step = "0.01"; }
    }
    input.value = user[key] ?? "";
    if (key === "position" && user.position_locked) input.disabled = true;
    inputs.set(key, input);
    label.append(input); fields.append(label);
  }
  const error = element("p", "", "employee-error"); error.setAttribute("role", "status");
  const save = element("button", "Сохранить", "employee-save"); save.type = "submit";
  form.append(fields, error, save);
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); save.disabled = true; error.textContent = "";
    const patch = {};
    for (const [key, input] of inputs) {
      if (input.disabled) continue;
      const value = input.value === "" ? null : ["oklad", "weekly_hours"].includes(key) ? Number(input.value) : input.value;
      if (String(user[key] ?? "") !== String(value ?? "")) patch[key] = value;
    }
    try {
      if (Object.keys(patch).length) await leaderUpdateDepartmentUser(user.user_id, patch);
      await load();
      dialog.close();
    } catch (failure) { error.textContent = message(failure); }
    finally { save.disabled = false; }
  });
  const flags = element("div", "", "employee-flags");
  for (const [key, title, checked] of [["editor", "Редактор общего табеля", user.is_editor], ["no_night_shifts", "Запретить ночные смены", user.no_night_shifts]]) {
    const label = element("label"); const input = element("input"); input.type = "checkbox"; input.checked = checked;
    label.append(input, document.createTextNode(title)); flags.append(label);
    input.addEventListener("change", async () => {
      const next = input.checked; input.disabled = true;
      const approved = await confirmFlag(title, `${user.display_name || "Сотрудник"}: ${next ? "включить" : "отключить"}?`);
      try {
        if (!approved) { input.checked = !next; return; }
        await leaderSetDepartmentUserFlag(user.user_id, key, next);
        await load();
      } catch (failure) { input.checked = !next; error.textContent = message(failure); }
      finally { input.disabled = false; }
    });
  }
  body.append(form, flags);
}
function viewTimesheet(user) {
  open(user, "Табель");
  const period = element("div", "", "employee-period");
  const month = element("select");
  const yearSelect = element("select");
  month.setAttribute("aria-label", "Месяц табеля");
  yearSelect.setAttribute("aria-label", "Год табеля");
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const caption = new Date(2026, i, 1).toLocaleDateString("ru-RU", { month: "long" });
    const option = element("option", caption[0].toUpperCase() + caption.slice(1));
    option.value = String(i); month.append(option);
  }
  for (let year = 2000; year <= 2100; year++) {
    const option = element("option", String(year)); option.value = String(year); yearSelect.append(option);
  }
  month.value = String(now.getMonth()); yearSelect.value = String(now.getFullYear());
  const output = element("div");
  output.setAttribute("aria-live", "polite");
  const monthLabel = element("label", "Месяц"); monthLabel.append(month);
  const yearLabel = element("label", "Год"); yearLabel.append(yearSelect);
  period.append(monthLabel, yearLabel); body.append(period, output);
  const refresh = async () => {
    const version = ++requestVersion;
    output.textContent = "Загрузка…";
    const year = Number(yearSelect.value);
    const monthIndex = Number(month.value);
    try {
      const data = await leaderGetUserTimesheet(user.user_id, year, monthIndex);
      if (version !== requestVersion || !dialog.open) return;
      output.replaceChildren();
      if (!data) { output.textContent = "Табель за этот месяц не сохранён."; return; }
      const table = element("table", "", "employee-timesheet");
      const thead = element("thead"); const tbody = element("tbody");
      const head = element("tr"); ["Дата", "День", "Ночь", "Код"].forEach((label) => {
        const cell = element("th", label); cell.scope = "col"; head.append(cell);
      }); thead.append(head); table.append(thead, tbody);
      for (let i=0; i<new Date(year,monthIndex+1,0).getDate(); i++) {
        const row = element("tr");
        const date = new Date(year, monthIndex, i+1);
        if ([0,6].includes(date.getDay())) row.className = "employee-weekend";
        const dateText = `${i+1} · ${date.toLocaleDateString("ru-RU", { weekday: "short" })}`;
        [dateText, data.dayHours?.[i] || "—", data.nightHours?.[i] || "—", LEAVE_LABELS[data.leaveType?.[i]] || data.leaveType?.[i] || "—"].forEach((value, cellIndex) => {
          const cell = element("td", String(value));
          if (cellIndex === 3 && data.leaveType?.[i]) cell.className = "employee-leave";
          row.append(cell);
        });
        tbody.append(row);
      }
      output.append(table);
    } catch (failure) { if (version === requestVersion) output.textContent = message(failure); }
  };
  month.addEventListener("change", refresh); yearSelect.addEventListener("change", refresh); void refresh();
}
dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
dialog.addEventListener("close", () => { requestVersion += 1; });
search.addEventListener("input", render);
const token = beginPageDataRequest({ critical: true });
try {
  await requireSession();
  await load();
  startPresenceHeartbeat("Сотрудники отдела");
} catch (failure) {
  showError(failure);
  document.getElementById("departmentName").textContent = "Доступ недоступен";
} finally { finishPageDataRequest(token); }
