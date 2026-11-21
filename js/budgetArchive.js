import { requireSession } from './auth.js';
import { getMyProfile, BudgetConflict } from './db.js';
import { loadBudgetSnapshot, saveBudgetSnapshot } from './features/budgetRepository.js?v=20261121-3';
import { categories, monthlyExpenses, todayISO, day, expenseDays, archiveExpenseDay, validDate, isArchivedBill, billArchiveDeleteDate } from './features/budgetModel.js?v=20261121-3';
import { createMoneyAccessGuard, isMoneyProtectionEnabled } from './moneyPrivacy.js';
import { beginPageDataRequest, finishPageDataRequest } from './pageLoader.js';
import { startPresenceHeartbeat } from './presence.js';

const $ = id => document.getElementById(id);
const money = value => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: value % 100 ? 2 : 0 }).format(value / 100);
const dateLabel = date => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(day(date));
const params = new URLSearchParams(location.search);
const focusDate = validDate(params.get('date')) ? params.get('date') : null;
let all = params.get('view') === 'all';
let billsView = params.get('view') === 'bills';
let snapshot, busy = false, loading = false, granted = false, editingId;
let renderedMonth = todayISO().slice(0, 7);
let renderedDay = todayISO();
const dialog = $('dialog');
const setStatus = message => { $('status').textContent = message; };
const action = run => async () => { try { await run(); } catch (error) { setStatus(error.message); } };
const button = (label, run) => { const node = document.createElement('button'); node.type = 'button'; node.className = 'plain'; node.textContent = label; node.onclick = action(run); return node; };

async function load() {
  loading = true;
  try {
    snapshot = await loadBudgetSnapshot();
    $('budgetContent').hidden = false;
    render();
    setStatus('Синхронизировано');
  } finally { loading = false; }
}

async function save(state) {
  if (busy || loading || !snapshot) throw new Error('Подождите синхронизации.');
  busy = true;
  try {
    snapshot = await saveBudgetSnapshot(state, snapshot.revision);
    render();
    setStatus('Сохранено');
  } catch (error) {
    if (error instanceof BudgetConflict) await load();
    throw error;
  } finally { busy = false; }
}

function edit(row) {
  if (busy || loading) return;
  editingId = row.id;
  $('dialogTitle').textContent = 'Расход · ' + dateLabel(row.date);
  $('archiveTitle').value = row.title ?? '';
  $('archiveAmount').value = row.amount / 100;
  const choices = new Set([...categories, row.category].filter(Boolean));
  $('archiveCategory').replaceChildren(...[...choices].map(value => new Option(value, value)));
  $('archiveCategory').value = row.category ?? 'Другое';
  $('error').textContent = '';
  dialog.showModal();
  $('archiveAmount').focus();
}

function render() {
  const state = snapshot.state;
  const monthNow = todayISO().slice(0, 7);
  if (!$('month').value) $('month').value = focusDate?.slice(0, 7) ?? monthNow;
  if (monthNow !== renderedMonth && $('month').value === renderedMonth) $('month').value = monthNow;
  renderedMonth = monthNow;
  renderedDay = todayISO();
  if (!$('expenseMonth').options.length) for (let month = 0; month < 12; month++) {
    $('expenseMonth').add(new Option(new Intl.DateTimeFormat('ru-RU', { month: 'long' }).format(new Date(2000, month, 1)), String(month)));
  }
  const years = new Set([monthNow.slice(0, 4), $('month').value.slice(0, 4)]);
  for (const row of state.records) { years.add(row.date.slice(0, 4)); if (row.settled) years.add(row.settled.slice(0, 4)); }
  $('expenseYear').replaceChildren(...[...years].sort().reverse().map(year => new Option(year, year)));
  $('expenseMonth').value = String(Number($('month').value.slice(5)) - 1);
  $('expenseYear').value = $('month').value.slice(0, 4);
  const monthly = monthlyExpenses(state, $('month').value);
  $('monthTotal').textContent = 'Всего за месяц · ' + money(monthly.total);
  $('stats').replaceChildren();
  const tracked = monthly.breakdown.reduce((sum, [, value]) => sum + value, 0);
  for (const [category, value] of monthly.breakdown.filter(([, value]) => value > 0).sort((a,b) => b[1] - a[1])) {
    const label = document.createElement('small'); label.textContent = category + ' · ' + money(value);
    const progress = document.createElement('progress'); progress.max = tracked; progress.value = value; progress.setAttribute('aria-label', category);
    $('stats').append(label, progress);
  }
  const note = document.createElement('small');
  note.textContent = [monthly.unclassified ? 'Без разбивки · ' + money(monthly.unclassified) : '', monthly.paid ? 'Обязательные платежи · ' + money(monthly.paid) : ''].filter(Boolean).join(' · ');
  $('stats').append(note);
  $('archivedTab').setAttribute('aria-selected', String(!all && !billsView));
  $('allTab').setAttribute('aria-selected', String(all && !billsView));
  $('billsTab').setAttribute('aria-selected', String(billsView));
  $('archiveStats').hidden = billsView;
  $('categoryHeading').textContent = billsView ? 'Оплаченные платежи' : 'По категориям';
  $('monthLabel').textContent = billsView ? 'Месяц оплаты' : 'Месяц';
  $('retentionNote').textContent = billsView ? 'Оплаченные платежи попадают сюда через 3 дня. Срок удаления указан у каждой записи.' : 'Записи расходов хранятся один календарный месяц. Их удаление не меняет остаток денег.';
  $('archiveRows').setAttribute('aria-labelledby', billsView ? 'billsTab' : all ? 'allTab' : 'archivedTab');
  $('archiveRows').replaceChildren();
  if (billsView) {
    const rows = state.records.filter(row => isArchivedBill(row, todayISO()) && row.settled.startsWith($('month').value)).sort((a,b) => b.settled.localeCompare(a.settled));
    if (!rows.length) { const empty = document.createElement('small'); empty.textContent = 'За этот месяц в архиве нет платежей'; $('archiveRows').append(empty); }
    const list = document.createElement('ul'); list.className = 'compact-expenses';
    for (const row of rows) {
      const item = document.createElement('li');
      const info = document.createElement('span');
      const title = document.createElement('strong'); title.textContent = row.title + ' · ' + money(row.amount);
      const detail = document.createElement('small'); detail.textContent = 'Оплачен ' + dateLabel(row.settled) + ' · срок ' + dateLabel(row.date) + ' · удаление ' + dateLabel(billArchiveDeleteDate(row));
      info.append(title, detail);
      item.append(info, button('Отменить оплату', () => save({ ...snapshot.state, records: snapshot.state.records.map(entry => entry.id === row.id ? { ...entry, amount: entry.plannedAmount ?? entry.amount, settled: null, settledStamp: null } : entry) })));
      list.append(item);
    }
    $('archiveRows').append(list);
    return;
  }
  const groups = expenseDays(monthly.expenses.filter(row => all || row.archived));
  if (!groups.length) { const empty = document.createElement('small'); empty.textContent = all ? 'За этот месяц нет сохранённых расходов' : 'В архиве пока нет расходов'; $('archiveRows').append(empty); }
  for (const group of groups) {
    const details = document.createElement('details'); details.className = 'expense-day-details'; details.id = 'expense-day-' + group.date; details.open = group.date === focusDate;
    const summary = document.createElement('summary'); summary.textContent = dateLabel(group.date) + ' · ' + money(group.amount) + ' · ' + group.rows.length + ' записей';
    const archived = group.rows.every(row => row.archived);
    const toggle = button(archived ? 'Вернуть на главную' : 'В архив', () => save(archiveExpenseDay(snapshot.state, group.date, !archived)));
    const list = document.createElement('ul'); list.className = 'compact-expenses';
    for (const row of group.rows) {
      const item = document.createElement('li');
      const info = document.createElement('span');
      const title = document.createElement('strong'); title.textContent = row.title + ' · ' + money(row.amount);
      const category = document.createElement('small'); category.textContent = row.category ?? 'Без категории';
      info.append(title, category); item.append(info, button('Изменить', () => edit(row))); list.append(item);
    }
    details.append(summary, toggle, list); $('archiveRows').append(details);
  }
}

for (const id of ['expenseMonth', 'expenseYear']) $(id).onchange = () => {
  $('month').value = $('expenseYear').value + '-' + String(Number($('expenseMonth').value) + 1).padStart(2, '0'); render();
};
$('archivedTab').onclick = () => { billsView = false; all = false; render(); };
$('allTab').onclick = () => { billsView = false; all = true; render(); };
$('billsTab').onclick = () => { billsView = true; render(); };
$('close').onclick = () => dialog.close();
dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
$('editor').onsubmit = async event => {
  event.preventDefault();
  const amount = Math.round(Number($('archiveAmount').value) * 100);
  if (!$('archiveAmount').value || !Number.isSafeInteger(amount) || amount <= 0 || amount > 100000000000 || !$('archiveAmount').checkValidity()) {
    $('error').textContent = 'Укажите сумму от 0,01 до 1 000 000 000 ₽.'; $('archiveAmount').focus(); return;
  }
  if (!snapshot.state.records.some(row => row.id === editingId)) { $('error').textContent = 'Запись уже удалена. Обновите архив.'; return; }
  $('submit').disabled = $('close').disabled = $('remove').disabled = true;
  try {
    await save({ ...snapshot.state, records: snapshot.state.records.map(row => row.id === editingId ? { ...row, amount, title: $('archiveTitle').value.trim() || 'Расход', category: $('archiveCategory').value } : row) });
    dialog.close();
  } catch (error) { $('error').textContent = error.message; }
  finally { $('submit').disabled = $('close').disabled = $('remove').disabled = false; }
};
$('remove').onclick = () => $('confirm').showModal();
$('cancelDelete').onclick = () => $('confirm').close();
$('confirm').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
$('confirmDelete').onclick = async () => {
  if (busy) return;
  $('confirmDelete').disabled = true;
  $('cancelDelete').disabled = $('close').disabled = true;
  try { await save({ ...snapshot.state, records: snapshot.state.records.filter(row => row.id !== editingId) }); $('confirm').close(); dialog.close(); }
  catch (error) { $('confirm').close(); $('error').textContent = error.message; }
  finally { $('confirmDelete').disabled = $('cancelDelete').disabled = $('close').disabled = false; }
};
async function refresh() {
  if (!granted || busy || loading || dialog.open) return;
  const profile = await getMyProfile({ fresh: true });
  if (profile?.role !== 'owner') { location.replace('profile.html'); return; }
  await load();
}
$('refresh').onclick = action(refresh);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void action(refresh)(); });
setInterval(() => { if (granted && todayISO() !== renderedDay) void action(refresh)(); }, 60000);

async function start() {
  const token = beginPageDataRequest({ label: 'Загружаем архив расходов…', critical: true, persistedSessionOnly: true });
  let failed = false;
  try {
    try { await requireSession(); } catch { location.replace('login.html?next=budget-archive.html'); return; }
    const profile = await getMyProfile();
    if (profile?.role !== 'owner') { location.replace('profile.html'); return; }
    startPresenceHeartbeat('Архив бюджета');
    const ensure = createMoneyAccessGuard(profile);
    const unlock = async () => {
      if (!await ensure()) return;
      granted = true; $('budgetLocked').hidden = true; await load();
      if (focusDate) requestAnimationFrame(() => document.getElementById('expense-day-' + focusDate)?.scrollIntoView({ block: 'start' }));
    };
    $('unlock').onclick = action(unlock);
    if (isMoneyProtectionEnabled(profile)) { $('budgetLocked').hidden = false; setStatus('Денежные данные скрыты'); }
    else await unlock();
  } catch (error) { failed = true; setStatus('Не удалось загрузить архив. ' + error.message); }
  finally { finishPageDataRequest(token, { failed }); }
}
void start();
