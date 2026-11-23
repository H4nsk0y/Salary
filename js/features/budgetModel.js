// Compatible with Hanskoy Finance a797917: all amounts are integer kopecks.
export const categories = ["Продукты", "Кафе", "Транспорт", "Дом", "Здоровье", "Развлечения", "Подписки", "Другое", "Лень считать"];
const dateFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" });
export const todayISO = () => dateFormat.format(new Date());
export const iso = (date) => date.toISOString().slice(0, 10);
export const day = (key) => new Date(key + "T00:00:00Z");
export const gap = (from, to) => (day(to) - day(from)) / 86400000;
export const kopecks = (amount) => Math.round(Number(amount) * 100);
export const newBudget = () => ({ daily: 0, people: 2, reserveBills: false, records: [] });
export const validDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(+day(value)) && iso(day(value)) === value;

export function normalizeBudget(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.records)
    || !Number.isSafeInteger(raw.daily) || raw.daily < 0) throw new Error("Не удалось прочитать формат бюджета. Данные не изменены.");
  const people = raw.people ?? 2;
  if (raw.reserveBills != null && typeof raw.reserveBills !== 'boolean') throw new Error('Некорректный режим учёта платежей.');
  if (raw.salaryAutoStart != null && !validDate(raw.salaryAutoStart)) throw new Error("Некорректная дата начала автозачисления.");
  if (raw.expenseHistoryFrom != null && !validDate(raw.expenseHistoryFrom)) throw new Error("Некорректная граница архива расходов.");
  if (!Number.isInteger(people) || people < 1 || people > 100) throw new Error("Количество людей должно быть от 1 до 100.");
  const anchor = raw.dailySpendingAnchor;
  if (anchor != null && (!validDate(anchor.date) ||
      ![anchor.total, anchor.reservedTotal].every(value => Number.isSafeInteger(value) && value >= 0) ||
      anchor.reservedTotal > anchor.total || (anchor.estimated != null && typeof anchor.estimated !== 'boolean'))) throw new Error("Некорректный дневной ориентир расходов. Данные не изменены.");
  for (const row of raw.records) {
    if (!row || !["income", "expense", "bill", "balance"].includes(row.type)
      || !validDate(row.date) || !Number.isSafeInteger(row.amount)
      || Math.abs(row.amount) > 100000000000 || (row.type !== "balance" && row.amount < 0)
      || (row.settled && !validDate(row.settled))
      || (row.nominal && (!validDate(row.nominal) || !/-(10|25)$/.test(row.nominal)))
      || (row.type === "bill" && row.remind != null && (!Number.isInteger(row.remind) || row.remind < 0 || row.remind > 365))
      || [row.stamp, row.settledStamp].some((stamp) => stamp != null && !Number.isSafeInteger(stamp))) {
      throw new Error("В бюджете есть некорректная запись. Исходные данные не изменены.");
    }
    if ([row.expenseCarry, row.billCarry].some(value => value != null && (!Number.isSafeInteger(value) || value < 0))) throw new Error("Некорректный итог удалённых списаний.");
  }
  return { ...raw, people, reserveBills: raw.reserveBills ?? false,
    ...(anchor ? { dailySpendingAnchor: { ...anchor } } : {}), records: raw.records.map((row) => ({ ...row })) };
}

export function expenseDays(records) {
  const groups = new Map();
  for (const row of records.filter(row => row.type === 'expense')) {
    if (!groups.has(row.date)) groups.set(row.date, { date: row.date, amount: 0, rows: [] });
    const group = groups.get(row.date);
    group.rows.push(row);
    group.amount += row.amount;
  }
  return [...groups.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export function archiveExpenseDay(state, date, archived) {
  return { ...state, records: state.records.map(row => row.type === 'expense' && row.date === date ? { ...row, archived } : row) };
}

export function salaryMonths(today) {
  const date = day(today);
  return [-1, 0, 1, 2].map((offset) => {
    const month = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
    return { year: month.getUTCFullYear(), month: month.getUTCMonth() };
  });
}

export function repairCurrentDayBalances(state, today) {
  const needsRepair = state.records.some(row => row.type === "balance" && row.date === today && row.closed && Number.isSafeInteger(row.stamp));
  if (!needsRepair) return state;
  // Today's end-of-day snapshot cannot yet cover later real transactions.
  // Persist this conversion so the corrected result does not reverse at midnight.
  return { ...state, records: state.records.map(row => row.type === "balance" && row.date === today && row.closed && Number.isSafeInteger(row.stamp)
    ? { ...row, closed: false } : row) };
}

function afterCheckpoint(row, checkpoint, today) {
  const date = row.type === 'expense' ? row.date : row.settled;
  const stamp = row.type === 'expense' ? row.stamp : row.settledStamp;
  return Boolean(date && date <= today && date >= checkpoint.date
    && (date !== checkpoint.date || (!checkpoint.closed && (stamp ?? 0) > (checkpoint.stamp ?? 0))));
}

function expiresOn(date) {
  const value = day(date);
  const year = value.getUTCFullYear(), month = value.getUTCMonth() + 1;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(year, month, Math.min(value.getUTCDate(), last))));
}

export function maintainBudget(state, today) {
  const repaired = repairCurrentDayBalances(state, today);
  const expired = repaired.records.filter(row => (row.type === 'expense' && expiresOn(row.date) <= today)
    || (row.type === 'bill' && row.settled && billArchiveDeleteDate(row) <= today));
  if (!expired.length) return repaired;
  const removed = new Set(expired);
  const records = repaired.records.filter(row => !removed.has(row)).map(row => {
    if (row.type !== 'balance') return row;
    const charges = expired.filter(expense => afterCheckpoint(expense, row, today));
    const expenseDebit = charges.filter(charge => charge.type === 'expense').reduce((sum, charge) => sum + charge.amount, 0);
    const billDebit = charges.filter(charge => charge.type === 'bill').reduce((sum, charge) => sum + charge.amount, 0);
    const debit = expenseDebit + billDebit;
    const expenseCarry = (row.expenseCarry ?? 0) + expenseDebit;
    const billCarry = (row.billCarry ?? 0) + billDebit;
    if (!Number.isSafeInteger(expenseCarry)) throw new Error('Слишком большая сумма архивных расходов. Данные не изменены.');
    if (!Number.isSafeInteger(billCarry)) throw new Error('Слишком большая сумма архивных платежей. Данные не изменены.');
    return debit ? { ...row, amount: row.amount - debit, expenseCarry, billCarry } : row;
  });
  const latest = expired.map(row => row.type === 'expense' ? row.date : row.settled).sort().at(-1);
  const from = iso(new Date(+day(latest) + 86400000));
  return { ...repaired, records, expenseHistoryFrom: [repaired.expenseHistoryFrom ?? '', from].sort().at(-1) };
}

export function isArchivedBill(row, today) {
  return row.type === 'bill' && Boolean(row.settled) && gap(row.settled, today) >= 3;
}

export function billArchiveDeleteDate(row) {
  const period = billPeriodRange(row.date);
  const end = iso(new Date(+day(period.end) + 86400000));
  const minimum = iso(new Date(+day(row.settled) + 4 * 86400000));
  return end > minimum ? end : minimum;
}

export function findPaidBillDuplicate(records, title, amount) {
  const normalize = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
  return records.filter(row => row.type === 'bill' && row.settled && row.amount === amount && normalize(row.title) === normalize(title))
    .sort((a, b) => b.settled.localeCompare(a.settled))[0] ?? null;
}

export function scheduled(today, records, salary = []) {
  const date = day(today);
  const slots = new Map();
  for (let offset = 0; offset <= 2; offset++) {
    for (const payday of [10, 25]) {
      const due = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, payday));
      const nominal = iso(due);
      while ([0, 6].includes(due.getUTCDay())) due.setUTCDate(due.getUTCDate() - 1);
      slots.set(nominal, { type: "income", nominal, date: iso(due), title: payday === 10 ? "Остаток зарплаты" : "Аванс" });
    }
  }
  const extra = [];
  for (const row of records.filter((row) => row.type === "income")) {
    if (row.nominal) slots.set(row.nominal, row);
    else extra.push(row);
  }
  for (const payment of salary) {
    const existing = slots.get(payment.nominal);
    if (existing?.settled || existing?.override) continue;
    slots.set(payment.nominal, {
      type: "income", title: payment.nominal.endsWith("-25") ? "Аванс" : "Остаток зарплаты",
      ...existing, ...payment,
    });
  }
  return [...slots.values(), ...extra].sort((a, b) => a.date.localeCompare(b.date));
}

export function budget(state, today, salary = []) {
  const records = state.records;
  const checkpoint = records.filter((r) => r.type === "balance" && r.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.stamp ?? 0) - (a.stamp ?? 0) || Number(b.closed) - Number(a.closed))[0];
  let current = checkpoint?.amount ?? null;
  for (const row of records) {
    if (!checkpoint || row.type === "balance") continue;
    if (!afterCheckpoint(row, checkpoint, today)) continue;
    current += row.type === "income" ? row.amount : -row.amount;
  }
  const incomes = scheduled(today, records, salary);
  const next = incomes.find((r) => !r.settled && r.date >= today);
  const bills = records.filter((r) => r.type === "bill" && !r.settled);
  const reserve = bills.filter((r) => next ? r.date < next.date : r.date <= today).reduce((sum, r) => sum + r.amount, 0);
  const paydayReserve = next ? bills.filter((r) => r.date === next.date).reduce((sum, r) => sum + r.amount, 0) : 0;
  const sameDayIncome = next ? incomes.filter((r) => !r.settled && r.date === next.date) : [];
  const incoming = !next || sameDayIncome.some((r) => r.amount === undefined) ? null
    : sameDayIncome.reduce((sum, r) => sum + r.amount, 0);
  const days = next ? gap(today, next.date) : 0;
  const free = current === null ? null : current - (state.reserveBills ? reserve : 0);
  const forecastBefore = free === null ? null : free - days * state.daily;
  const forecast = forecastBefore;
  return { checkpoint, current, incomes, next, reserve, paydayReserve, incoming, days, free, forecastBefore, forecast };
}

export function dailySpendingLimit(result, people) {
  const days = result.next ? Math.max(1, result.days) : 0;
  if (result.free === null || !days) return { days, total: 0, perPerson: 0 };
  const total = Math.max(0, result.free) / days;
  return { days, total, perPerson: total / people };
}

export function billPeriodRange(date) {
  const value = day(date);
  const year = value.getUTCFullYear(), month = value.getUTCMonth(), number = value.getUTCDate();
  if (number >= 25) return { start: iso(new Date(Date.UTC(year, month, 25))), end: iso(new Date(Date.UTC(year, month + 1, 10))) };
  if (number >= 10) return { start: iso(new Date(Date.UTC(year, month, 10))), end: iso(new Date(Date.UTC(year, month, 25))) };
  return { start: iso(new Date(Date.UTC(year, month - 1, 25))), end: iso(new Date(Date.UTC(year, month, 10))) };
}

export function billUrgency(date, today) {
  const days = gap(today, date);
  return days <= 0 ? 'red' : days <= 2 ? 'yellow' : days <= 3 ? 'green' : null;
}

export function upcomingBudgetBills(state, today) {
  return state.records.filter(row => row.type === 'bill' && !row.settled
    && gap(today, row.date) >= 0 && gap(today, row.date) <= (row.remind ?? 1));
}

export function budgetIncomeCycle(today) {
  const value = day(today);
  const month = value.getUTCMonth() - (value.getUTCDate() < 10 ? 1 : 0);
  const year = value.getUTCFullYear();
  return { start: iso(new Date(Date.UTC(year, month, 10))), end: iso(new Date(Date.UTC(year, month + 1, 10))) };
}

export function cycleIncomes(incomes, today) {
  const { start, end } = budgetIncomeCycle(today);
  return incomes.filter(row => {
    const date = row.nominal ?? row.date;
    return date > start && date <= end;
  });
}

export function nextBudgetIncome(incomes, records, today) {
  const { end } = budgetIncomeCycle(today);
  const nominal = end.slice(0, 8) + "25";
  if (!records.some(row => row.type === "bill" && !row.settled && row.date >= nominal)) return null;
  return incomes.find(row => row.nominal === nominal) ?? null;
}

// Use the event's scheduled time, not the retry time: a later balance checkpoint
// may already include this income. Stable nominal keys make retries idempotent.
export function receiveDueSalary(state, salary, now = new Date()) {
  const today = dateFormat.format(now);
  const start = state.salaryAutoStart ?? today;
  let changed = !state.salaryAutoStart;
  let records = [...state.records];
  for (const payment of scheduled(today, records, salary)) {
    if (!payment.nominal || payment.settled || payment.autoSkipped || payment.date < start || payment.date > today
      || !Number.isSafeInteger(payment.amount)) continue;
    const eventTime = Date.parse(payment.date + "T10:00:00+03:00");
    if (+now < eventTime) continue;
    const received = { ...payment, id: payment.id ?? "salary-" + payment.nominal, type: "income",
      settled: payment.date, settledStamp: eventTime, stamp: payment.stamp ?? eventTime, automatic: true };
    records = [...records.filter(row => !(row.type === "income" && row.nominal === payment.nominal)), received];
    changed = true;
  }
  return changed ? { ...state, salaryAutoStart: start, records } : state;
}

export function monthlyExpenses(state, month) {
  const expenses = state.records.filter((row) => row.type === "expense" && row.date.startsWith(month));
  const paidBills = state.records.filter((row) => row.type === "bill" && row.settled?.startsWith(month));
  const total = [...expenses, ...paidBills].reduce((sum, row) => sum + row.amount, 0);
  const breakdown = categories.filter((category) => category !== "Лень считать")
    .map((category) => [category, expenses.filter((row) => row.category === category).reduce((sum, row) => sum + row.amount, 0)]);
  const unclassified = expenses.filter((row) => !categories.includes(row.category) || row.category === "Лень считать")
    .reduce((sum, row) => sum + row.amount, 0);
  return { expenses, total, breakdown, unclassified, paid: paidBills.reduce((sum, row) => sum + row.amount, 0) };
}
