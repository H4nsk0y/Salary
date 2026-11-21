import { categories, todayISO, day, gap, kopecks, budget, salaryMonths, validDate, billPeriodRange, receiveDueSalary, budgetIncomeCycle, cycleIncomes, nextBudgetIncome, expenseDays, archiveExpenseDay, newBudget, dailySpendingLimit, billUrgency, isArchivedBill, findPaidBillDuplicate } from "./features/budgetModel.js?v=20261121-3";
import { buildBudgetSalary } from "./features/budgetSalary.js";
import { requireSession } from "./auth.js";
import { getMyProfile, listMyBudgetTimesheets, BudgetConflict } from "./db.js";
import { beginPageDataRequest, finishPageDataRequest } from "./pageLoader.js";
import { createMoneyAccessGuard, isMoneyProtectionEnabled } from "./moneyPrivacy.js";
import { startPresenceHeartbeat } from "./presence.js";
import { bindEmploymentDateCalendar, formatEmploymentDateInput, normalizeEmploymentDateInput } from "./features/employmentDateCalendar.js";
import { loadBudgetSnapshot, saveBudgetSnapshot } from "./features/budgetRepository.js?v=20261121-3";

const $ = id => document.getElementById(id);
const money = value => value === null || value === undefined ? '—' : new Intl.NumberFormat('ru-RU', {
  style: 'currency', currency: 'RUB', maximumFractionDigits: value % 100 ? 2 : 0,
}).format(value / 100);
const dateLabel = key => new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric', month: 'long', timeZone: 'UTC',
}).format(day(key));
let state = newBudget();
let revision = null;
let busy = false;
let ready = false;
let editAction = null;
let salary = [];
let salaryStatus = '';
let salaryRequest = null;
let profile = null;
let accessGranted = false;
let actionReturnFocus = null;
let loadRequest = null;
let spendingContext = '';
let previewDaily = 0;
const text = (id, value) => { $(id).textContent = value; };
const button = (title, action) => {
  const node = document.createElement('button');
  node.className = 'plain';
  node.type = 'button';
  node.textContent = title;
  node.onclick = action;
  return node;
};

async function refreshSalary() {
  if (!accessGranted || salaryRequest) return;
  salaryStatus = "Обновляем выплаты…";
  text("calendar", salaryStatus);
  const pending = listMyBudgetTimesheets(salaryMonths(todayISO()))
    .then((rows) => buildBudgetSalary(rows, todayISO(), profile?.branch, undefined, profile));
  salaryRequest = pending;
  try {
    salary = await pending;
    await creditDueSalary();
    salaryStatus = salary.some((row) => row.date >= todayISO() && row.amount !== undefined)
      ? "Выплаты обновлены из табелей Salary."
      : "В сохранённых табелях пока нет сумм ближайших выплат.";
  } catch {
    salaryStatus = salary.length ? "Не удалось обновить выплаты. Показан последний загруженный прогноз."
      : "Не удалось загрузить выплаты. Даты ниже предварительные; суммы можно указать вручную.";
  } finally {
    salaryRequest = null;
    render();
  }
}

async function creditDueSalary() {
  if (!ready || busy || loadRequest || dialog.open || revision === null) return;
  const next = receiveDueSalary(state, salary);
  if (next !== state) await save(next);
}

async function load() {
  if (loadRequest) return loadRequest;
  loadRequest = (async () => {
      const snapshot = await loadBudgetSnapshot();
      state = snapshot.state;
      revision = snapshot.revision;
      ready = true;
      $("budgetContent").hidden = false;
      $("daily").disabled = false;
      text("status", "Синхронизировано");
      render();
  })();
  try { await loadRequest; } finally { loadRequest = null; }
}

async function save(next) {
  if (busy || loadRequest || !ready) throw new Error('Подождите завершения синхронизации.');
  busy = true;
  try {
    const row = await saveBudgetSnapshot(next, revision);
    revision = row.revision;
    state = row.state;
    render();
    text("status", "Сохранено");
  } catch (error) {
    if (error instanceof BudgetConflict) {
      try { await load(); } catch { ready = false; }
    }
    throw error;
  } finally {
    busy = false;
  }
}

const update = row => save({
  ...state, records: [...state.records.filter(r => r.id !== row.id &&
    !(row.type === "income" && row.nominal && r.type === "income" && r.nominal === row.nominal)), row],
});
const report = action => async () => {
  try { await action(); } catch (error) { render(); text('status', error.message); }
};
const form = $('editor');
const dialog = $('dialog');


async function confirmRemoval() {
  return new Promise(resolve => {
    const confirmation = document.createElement("dialog");
    confirmation.className = "budget-confirm";
    confirmation.setAttribute("aria-label", "Удалить запись?");
    const title = document.createElement("h2");
    title.textContent = "Удалить запись?";
    const cancel = button("Оставить", () => confirmation.close("cancel"));
    const yes = button("Удалить", () => confirmation.close("yes"));
    confirmation.append(title, cancel, yes);
    confirmation.addEventListener("close", () => { const accepted = confirmation.returnValue === "yes"; confirmation.remove(); resolve(accepted); }, { once: true });
    document.body.append(confirmation);
    confirmation.showModal();
    cancel.focus();
  });
}

async function confirmDuplicateBill(row) {
  return new Promise(resolve => {
    const confirmation = document.createElement('dialog');
    confirmation.className = 'budget-confirm';
    confirmation.setAttribute('aria-label', 'Платёж уже оплачивался');
    const title = document.createElement('h2'); title.textContent = 'Платёж уже оплачивался';
    const copy = document.createElement('p');
    copy.textContent = `Вы уже оплачивали «${row.title}» ${dateLabel(row.settled)} на ${money(row.amount)}. Добавить ещё один платёж?`;
    const link = document.createElement('a'); link.className = 'budget-link'; link.href = 'budget-archive.html?view=bills&date=' + row.settled; link.textContent = 'Архив платежей';
    const cancel = button('Не добавлять', () => confirmation.close('cancel'));
    const yes = button('Добавить повторно', () => confirmation.close('yes'));
    confirmation.append(title, copy, link, cancel, yes);
    confirmation.addEventListener('close', () => { const accepted = confirmation.returnValue === 'yes'; confirmation.remove(); resolve(accepted); }, { once: true });
    document.body.append(confirmation); confirmation.showModal(); cancel.focus();
  });
}

function field(label, name, type, value = '', options = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'budget-field';
  const caption = document.createElement('label');
  caption.textContent = label;
  caption.htmlFor = 'budget-field-' + name;
  const node = document.createElement(type === 'select' || type === 'textarea' ? type : 'input');
  if (type === 'select') {
    for (const [key, title] of options.choices) node.add(new Option(title, key));
  } else if (type !== 'textarea') node.type = type === 'date' ? 'text' : type;
  node.id = caption.htmlFor;
  node.dataset.label = label;
  node.name = name;
  node.required = options.required ?? true;
  node.value = type === 'date' ? formatEmploymentDateInput(value) : value;
  for (const attr of ['min', 'max', 'step', 'maxLength']) {
    if (type !== 'date' && options[attr] !== undefined) node[attr] = options[attr];
  }
  wrapper.append(caption);
  if (type === 'date') {
    node.dataset.date = 'true';
    node.dataset.min = options.min ?? '2000-01-01';
    node.dataset.max = options.max ?? '2100-12-31';
    node.placeholder = 'ДД.ММ.ГГГГ';
    node.maxLength = 10;
    node.inputMode = 'numeric';
    const control = document.createElement('div');
    control.className = 'budget-date-field';
    const opener = button('', () => {});
    opener.setAttribute('aria-label', 'Выбрать дату');
    opener.title = 'Выбрать дату';
    opener.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3M17 3v3M4 9h16M5 5h14v15H5Z"/></svg>';
    const calendar = $('budgetCalendarTemplate').content.firstElementChild.cloneNode(true);
    control.append(node, opener);
    wrapper.append(control, calendar);
    bindEmploymentDateCalendar(node, opener, calendar, { minDate: node.dataset.min, maxDate: node.dataset.max });
  } else wrapper.append(node);
  $('fields').append(wrapper);
  if ($('fields').children.length === 1) node.focus();
  return node;
}

function editor(title, action, remove, submit = 'Сохранить', pending = 'Сохраняем…') {
  form.dataset.pending = pending;
  actionReturnFocus = document.activeElement;
  text('feedback', '');
  text('dialogTitle', title);
  text('submit', submit);
  text('error', '');
  $('fields').replaceChildren();
  $('remove').hidden = !remove;
  $('remove').onclick = async () => {
    if (!await confirmRemoval()) return;
    $('submit').disabled = $('remove').disabled = $('close').disabled = true;
    try { await remove(); dialog.close(); } catch (error) { text('error', error.message); }
    finally { $('submit').disabled = $('remove').disabled = $('close').disabled = false; }
  };
  editAction = action;
  dialog.showModal();
}

$('close').onclick = () => dialog.close();
dialog.addEventListener('cancel', event => {
  if ($('submit').disabled) event.preventDefault();
});
dialog.addEventListener('close', () => {
  actionReturnFocus?.focus({ preventScroll: true });
});
form.onsubmit = async event => {
  event.preventDefault();
  if ($('submit').disabled) return;
  for (const node of form.elements) {
    if (!node.willValidate) continue;
    const date = node.dataset.date ? normalizeEmploymentDateInput(node.value) : null;
    if (!node.checkValidity() || (node.dataset.date && (!date || date < node.dataset.min || date > node.dataset.max))) {
      const label = node.dataset.label ?? 'Значение';
      text('error', node.validity.valueMissing ? `Заполните поле «${label}».`
        : node.dataset.date ? `Проверьте поле «${label}»: нужна дата в допустимом диапазоне.`
        : `Проверьте поле «${label}»: значение вне допустимого диапазона или формата.`);
      node.setAttribute('aria-invalid', 'true');
      node.setAttribute('aria-describedby', 'error');
      node.focus();
      return;
    }
  }
  const label = $('submit').textContent;
  $('submit').disabled = true;
  $('remove').disabled = true;
  $('close').disabled = true;
  text('submit', form.dataset.pending);
  text('feedback', form.dataset.pending);
  text('error', '');
  try {
    const data = Object.fromEntries(new FormData(form));
    for (const node of form.querySelectorAll('[data-date]')) data[node.name] = normalizeEmploymentDateInput(node.value);
    const result = await editAction(data);
    if (result !== false) dialog.close();
  } catch (error) { text('error', error.message); }
  finally {
    $('submit').disabled = false;
    $('remove').disabled = false;
    $('close').disabled = false;
    text('submit', label);
    text('feedback', '');
  }
};
form.addEventListener('input', event => {
  event.target.removeAttribute('aria-invalid');
  event.target.removeAttribute('aria-describedby');
  text('error', '');
});

const nextStamp = () => state.records.reduce(
  (stamp, row) => Math.max(stamp, (row.stamp ?? 0) + 1, (row.settledStamp ?? 0) + 1),
  Date.now(),
);

const labels = { bill: 'Платёж', expense: 'Расход', balance: 'Баланс', income: 'Поступление' };

function record(type, row = {}, settle = false) {
  if (!ready || loadRequest) { text('status', 'Бюджет ещё загружается.'); return; }
  const today = todayISO();
  editor(settle ? (type === 'bill' ? 'Отметить оплату' : 'Отметить поступление') : type === 'balance' ? 'Деньги в наличии' : labels[type], async data => {
    const next = {
      ...row, id: row.id ?? crypto.randomUUID(), type,
      title: data.title?.trim() || labels[type],
      date: settle ? row.date : data.date,
      amount: kopecks(data.amount),
      stamp: row.stamp ?? nextStamp(),
    };
    if (type === 'balance') next.amount -= (row.expenseCarry ?? 0) + (row.billCarry ?? 0);
    if (!validDate(data.date) || data.date < "2000-01-01" ||
        ((settle || ["expense", "balance"].includes(type)) && data.date > today)) throw new Error("Проверьте дату.");
    if (type === 'balance' && state.expenseHistoryFrom && data.date !== row.date && data.date < state.expenseHistoryFrom) {
      throw new Error('Детальные расходы за эту дату уже удалены. Укажите новую сверку за доступный период.');
    }
    if (!Number.isSafeInteger(next.amount) || next.amount < (type === "balance" ? -100000000000 : 0) ||
        next.amount > 100000000000 || (!["income", "balance"].includes(type) && next.amount === 0)) throw new Error("Проверьте сумму.");
    if (type === 'balance') next.closed = data.mode === 'close' && data.date < today;
    if (type === 'expense') next.category = data.category;
    if (type === 'bill' && !settle) next.remind = Number(data.remind);
    if (type === 'income' && row.nominal) {
      next.override = Boolean(row.override || next.date !== row.date || next.amount !== row.amount);
    }
    if (settle) {
      next.settled = data.date;
      next.settledStamp = row.settledStamp ?? nextStamp();
      next.title = row.title;
    }
    if (type === 'bill' && !row.id && !settle) {
      const previous = findPaidBillDuplicate(state.records, next.title, next.amount);
      if (previous && !await confirmDuplicateBill(previous)) return false;
    }
    await update(next);
  }, row.id && !settle ? () => save({ ...state, records: state.records.filter(r => r.id !== row.id) }) : null);
  if (!settle && type !== 'balance') field('Название', 'title', 'text', row.title, { required: type !== 'expense', maxLength: 90 });
  field('Сумма в ₽', 'amount', 'number', row.amount === undefined ? '' : (row.amount + (type === 'balance' ? (row.expenseCarry ?? 0) + (row.billCarry ?? 0) : 0)) / 100,
    { min: type === 'balance' ? -1000000000 : type === 'income' ? 0 : .01, max: 1000000000, step: .01 });
  const dateField = field(settle ? 'Фактическая дата' : 'Дата', 'date', 'date', settle ? (row.settled ?? today) : (row.date ?? today),
    { max: settle || ['expense', 'balance'].includes(type) ? today : undefined,
      min: type === 'balance' && (!row.id || row.date >= (state.expenseHistoryFrom ?? '')) ? state.expenseHistoryFrom ?? '2000-01-01' : '2000-01-01' });
  if (type === 'balance' && row.id && row.date < (state.expenseHistoryFrom ?? '')) dateField.readOnly = true;
  if (type === 'balance') {
    const mode = field('Когда снят остаток', 'mode', 'select', row.closed ? 'close' : 'now',
      { choices: [['now', 'На момент записи'], ['close', 'На конец прошедшего дня']] });
    const dateInput = form.elements.namedItem('date');
    const updateMode = () => {
      mode.options[1].disabled = !(normalizeEmploymentDateInput(dateInput.value) < today);
      if (mode.options[1].disabled) mode.value = 'now';
    };
    dateInput.addEventListener('input', updateMode);
    dateInput.addEventListener('change', updateMode);
    updateMode();
  }
  if (type === 'expense') field('Категория', 'category', 'select', row.category ?? categories[0],
    { choices: categories.map(x => [x, x]) });
  if (type === 'bill' && !settle) field('Напомнить за дней', 'remind', 'number', row.remind ?? 1, { min: 0, max: 365, step: 1 });
}

for (const type of Object.keys(labels)) $(type).onclick = () => record(type);
$("household").onclick = () => {
  editor("На сколько людей считать бюджет", data => {
    const people = Number(data.people);
    if (!Number.isInteger(people) || people < 1 || people > 100) throw new Error("Укажите от 1 до 100 человек.");
    return save({ ...state, people });
  });
  field("Количество людей", "people", "number", state.people, { min: 1, max: 100, step: 1 });
};

function householdLabel() {
  return state.people === 1 ? "Свободно на одного" : state.people === 2 ? "Свободно на двоих" : `Свободно на ${state.people} человек`;
}

function renderRows(id, rows, type, empty) {
  const list = $(id);
  list.replaceChildren();
  if (!rows.length) {
    const line = document.createElement('small');
    line.textContent = empty;
    list.append(line);
  }
  for (const row of rows) {
    const li = document.createElement('li');
    if (type === 'bill' && !row.settled && row.date < todayISO()) li.classList.add('overdue');
    const info = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = row.title + (row.amount === undefined ? '' : ' · ' + money(row.amount + (type === 'balance' ? (row.expenseCarry ?? 0) + (row.billCarry ?? 0) : 0)));
    const details = document.createElement('small');
    details.className = 'detail';
    details.textContent = [dateLabel(row.date), row.closed ? 'на конец дня' : null, row.category, row.source === 'salary' ? (row.override ? 'Исправлено вручную' : row.confirmed ? 'Подтверждено в Salary' : 'Прогноз Salary') : null,
      row.settled ? (type === 'bill' ? 'оплачен ' : row.automatic ? 'автозачисление ' : 'получено ') + dateLabel(row.settled) : null].filter(Boolean).join(' · ');
    info.append(title, details);
    li.append(info);
    const edit = button(row.amount !== undefined ? 'Изменить' : 'Указать сумму', () => record(type, row, Boolean(row.settled)));
    if (['bill', 'income'].includes(type) && row.amount !== undefined) {
      li.append(button(row.settled ? (type === 'bill' ? 'Вернуть' : 'Снять отметку') : type === 'bill' ? 'Оплачено' : 'Получено', row.settled
        ? report(() => update({ ...row, amount: type === 'bill' ? (row.plannedAmount ?? row.amount) : row.amount, settled: null, settledStamp: null, autoSkipped: type === 'income' }))
        : type === 'bill' ? report(() => update({ ...row, plannedAmount: row.amount, settled: todayISO(), settledStamp: nextStamp() }))
        : () => record(type, row, true)));
    }
    if (type === 'bill') {
      li.classList.add('budget-bill');
      li.classList.toggle('is-paid', Boolean(row.settled));
      const urgency = !row.settled && billUrgency(row.date, todayISO());
      if (urgency) li.classList.add('urgency-' + urgency);
      edit.setAttribute('aria-label', 'Изменить');
      edit.title = row.settled ? 'Исправить сумму или дату оплаты' : 'Изменить платёж';
      edit.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7l-4-4L4 15Z"/></svg>';
    }
    li.append(edit);
    list.append(li);
  }
}

function renderSlider(result, value) {
  const person = value / state.people;
  text('dailyValue', (Math.abs(person - Math.round(person)) > .000001 ? '≈ ' : '') + money(person));
  const before = result.free === null ? null : Math.round(result.free - value * dailySpendingLimit(result, state.people).days);
  text('forecast', money(before));
  text('cashGap', before < 0 ? 'До выплаты не хватает ' + money(-before) : '');
  $('cashGap').hidden = !(before < 0);
  $('forecast').classList.toggle('negative', before < 0);
}

function renderExpenses(today) {
  const rows = state.records.filter(row => row.type === 'expense' && !row.archived);
  const current = rows.filter(row => row.date >= today).sort((a, b) => (b.stamp ?? 0) - (a.stamp ?? 0));
  renderRows('expenses', current, 'expense', rows.length ? '' : 'Пока нет расходов');
  const list = $('expenses');
  if (rows.length && !current.length) list.replaceChildren();
  for (const group of expenseDays(rows.filter(row => row.date < today))) {
    const line = document.createElement('li');
    line.dataset.expenseDay = group.date;
    const info = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = dateLabel(group.date) + ' · ' + money(group.amount);
    const detail = document.createElement('small');
    detail.textContent = group.rows.length + ' записей';
    info.append(title, detail);
    const link = document.createElement('a');
    link.className = 'budget-link';
    link.href = 'budget-archive.html?view=all&date=' + group.date;
    link.textContent = 'Открыть';
    line.append(info, link, button('В архив', report(() => save(archiveExpenseDay(state, group.date, true)))));
    list.append(line);
  }
}

function renderBills(bills) {
  bills = bills.filter(row => !isArchivedBill(row, todayISO()));
  const container = $('bills');
  container.replaceChildren();
  const groups = new Map();
  for (const row of bills.filter(row => !row.settled)) {
    const period = billPeriodRange(row.date);
    if (!groups.has(period.start)) groups.set(period.start, { ...period, rows: [] });
    groups.get(period.start).rows.push(row);
  }
  function appendGroup(id, title, rows) {
    const heading = document.createElement('div');
    heading.className = 'bill-period-title';
    const label = document.createElement('h3');
    label.textContent = title;
    const total = document.createElement('span');
    total.textContent = money(rows.reduce((sum, row) => sum + row.amount, 0));
    heading.append(label, total);
    const list = document.createElement('ul');
    list.id = id;
    container.append(heading, list);
    renderRows(id, rows, 'bill', 'Пока нет платежей');
  }
  for (const group of [...groups.values()].sort((a, b) => a.start.localeCompare(b.start))) {
    const label = group.start.slice(0, 4) === group.end.slice(0, 4) ? dateLabel
      : value => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(day(value));
    appendGroup('bill-period-' + group.start, `С ${label(group.start)} по ${label(group.end)}`, group.rows);
  }
  const paid = bills.filter(row => row.settled).sort((a, b) => b.settled.localeCompare(a.settled));
  if (paid.length) appendGroup('bills-paid', 'Оплаченные', paid);
  if (!bills.length) { const empty = document.createElement('small'); empty.textContent = 'Пока нет платежей'; container.append(empty); }
  const total = bills.reduce((sum, row) => sum + row.amount, 0);
  const received = paid.reduce((sum, row) => sum + row.amount, 0);
  text('billOutstanding', 'Осталось оплатить · ' + money(total - received));
  text('billOverall', 'Всего · ' + money(total) + ' · Оплачено · ' + money(received));
}

function render() {
  if (!ready) { text('status', 'Бюджет ещё загружается.'); return; }
  const today = todayISO();
  const result = budget(state, today, salary);
  text('today', new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  }).format(day(today)));
  text("freeLabel", householdLabel());
  text("household", `${state.people} ${state.people === 1 ? "человек" : state.people >= 2 && state.people <= 4 ? "человека" : "человек"}`);
  text('free', money(result.free));
  $('free').classList.toggle('negative', result.free < 0);
  text('reserve', state.reserveBills ? 'Резерв до выплаты · ' + money(result.reserve) : 'Резерв платежей · выключен');
  text('perPerson', state.people > 1 && result.free !== null ? 'На человека · ' + money(Math.floor(result.free / state.people)) : '');
  text('current', money(result.current));
  text('checkpoint', result.checkpoint ? 'Последняя сверка · ' + dateLabel(result.checkpoint.date) : 'Укажите общую сумму денег в наличии');
  text("balance", "Указать баланс");
  text('next', result.next ? dateLabel(result.next.date) : '—');
  text('nextAmount', result.next ? result.next.title + ' · ' + (result.next.amount === undefined ? 'сумма не указана' : money(result.next.amount)) : '');
  text("paymentSource", result.next?.override ? "Исправлено вручную" : result.next?.confirmed ? "Подтверждено в Salary" : result.next?.source === "salary" ? "Прогноз Salary" : "");
  text('days', result.days ? 'Дней до выплаты: ' + result.days : 'Выплата сегодня');
  const limit = dailySpendingLimit(result, state.people);
  const approximate = Math.abs(limit.perPerson - Math.round(limit.perPerson)) > .000001 ? '≈ ' : '';
  text('dailyHint', result.free !== null ? 'Максимум в день на одного · ' + approximate + money(limit.perPerson) : 'Укажите деньги в наличии');
  const context = [today, result.current, result.free, state.people, Boolean(state.reserveBills), result.next?.date].join('|');
  if (context !== spendingContext) { spendingContext = context; previewDaily = limit.total; }
  previewDaily = Math.min(previewDaily, limit.total);
  $('daily').max = limit.perPerson / 100;
  $('daily').value = previewDaily / state.people / 100;
  $('daily').disabled = result.free === null || !limit.total;
  $('reserveBills').checked = Boolean(state.reserveBills);
  text('rangeMax', approximate + money(limit.perPerson));
  renderSlider(result, previewDaily);
  renderedDay = today;
  const sortDate = (a, b) => a.date.localeCompare(b.date);
  const bills = state.records.filter(r => r.type === 'bill').sort(sortDate);
  const due = bills.filter(r => !r.settled && gap(today, r.date) <= (r.remind ?? 1));
  $('reminders').replaceChildren();
  for (const row of due) {
    const line = document.createElement('div');
    line.className = 'budget-reminder';
    const urgency = billUrgency(row.date, today);
    if (urgency) line.classList.add('urgency-' + urgency);
    line.textContent = row.title + ' · ' + (row.date < today ? 'просрочен' : row.date === today ? 'сегодня' : dateLabel(row.date));
    $('reminders').append(line);
  }
  $('reminders').hidden = !due.length;
  renderBills(bills);
  renderRows('balances', state.records.filter(r => r.type === 'balance').sort((a, b) => sortDate(b, a) || b.stamp - a.stamp), 'balance', 'Пока нет сверок');
  renderExpenses(today);
  text('calendar', salaryStatus);
  const shown = cycleIncomes(result.incomes, today);
  const received = shown.filter(row => row.settled);
  const pending = shown.filter(row => !row.settled);
  const cycle = budgetIncomeCycle(today);
  text('incomePeriod', `С ${dateLabel(cycle.start)} по ${dateLabel(cycle.end)}`);
  renderRows('incomes', shown, 'income', 'Пока нет поступлений');
  const incomeSum = rows => rows.reduce((sum, row) => sum + (row.amount ?? 0), 0);
  text('incomeTotal', 'Общий доход за период · ' + money(incomeSum(shown)) + (shown.some(row => row.amount === undefined) ? ' + суммы без расчёта' : ''));
  text('incomeActual', 'Зачислено · ' + money(incomeSum(received)) + ' · Ожидается · ' + money(incomeSum(pending)));
  const nextIncome = nextBudgetIncome(result.incomes, state.records, today);
  $('extraIncome').hidden = !nextIncome;
  if (nextIncome) renderRows('nextIncome', [nextIncome], 'income', '');
}

$('daily').oninput = () => {
  previewDaily = Number($('daily').value) * 100 * state.people;
  renderSlider(budget(state, todayISO(), salary), previewDaily);
};
$('reserveBills').onchange = report(() => save({ ...state, reserveBills: $('reserveBills').checked }));

let renderedDay = todayISO();
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && ready && !dialog.open && !busy) void refreshAll();
});
setInterval(() => {
  if (ready && !dialog.open && todayISO() !== renderedDay) {
    void refreshAll();
  }
  if (ready && revision !== null && !dialog.open && receiveDueSalary(state, salary) !== state) void refreshAll();
}, 60000);
async function refreshAll() {
  if (busy || loadRequest || dialog.open || !accessGranted) return;
  $("refresh").disabled = true;
  try {
    const latest = await getMyProfile({ fresh: true });
    if (latest?.role !== "owner") { location.replace("profile.html"); return; }
    profile = latest;
    await load();
    await refreshSalary();
  } catch (error) {
    text("status", "Не удалось обновить бюджет. " + error.message);
  } finally { $("refresh").disabled = false; }
}
$("refresh").onclick = () => void refreshAll();

async function start() {
  const token = beginPageDataRequest({ label: "Загружаем бюджет…", critical: true, persistedSessionOnly: true });
  let failed = false;
  try {
    try { await requireSession(); } catch { location.replace("login.html?next=budget.html"); return; }
    profile = await getMyProfile();
    if (profile?.role !== "owner") { location.replace("profile.html"); return; }
    startPresenceHeartbeat("Мой бюджет");
    const ensureAccess = createMoneyAccessGuard(profile, { title: "Показать бюджет", description: "Введите PIN-код для доступа к денежным данным." });
    const unlock = async () => {
      if (!await ensureAccess()) return;
      accessGranted = true;
      $("budgetLocked").hidden = true;
      await load();
      await refreshSalary();
    };
    $("unlock").onclick = report(unlock);
    if (isMoneyProtectionEnabled(profile)) {
      text("status", "Денежные данные скрыты");
      $("budgetLocked").hidden = false;
    } else await unlock();
  } catch (error) {
    failed = true;
    text("status", "Не удалось загрузить бюджет. " + error.message);
  } finally { finishPageDataRequest(token, { failed }); }
}
void start();
