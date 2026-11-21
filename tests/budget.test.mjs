import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { budget, scheduled, normalizeBudget, salaryMonths, monthlyExpenses, validDate, billPeriodRange, receiveDueSalary, budgetIncomeCycle, cycleIncomes, nextBudgetIncome, repairCurrentDayBalances, maintainBudget, expenseDays, archiveExpenseDay, dailySpendingLimit, billUrgency, upcomingBudgetBills, isArchivedBill, billArchiveDeleteDate, findPaidBillDuplicate } from "../js/features/budgetModel.js";
import { salaryAmount, buildBudgetSalary, calculateBudgetPayments } from "../js/features/budgetSalary.js";
import { resolvePaymentDate } from "../js/features/paymentCalendar.js";

const state = (records, extra = {}) => ({ daily: 50000, records, ...extra });
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test('paid bills archive after three days and expire at the period boundary with late-payment grace', () => {
  const regular = { id: 'bill', type: 'bill', title: 'Кредит', date: '2026-12-05', amount: 100000, settled: '2026-12-01', settledStamp: 2 };
  assert.equal(isArchivedBill(regular, '2026-12-03'), false);
  assert.equal(isArchivedBill(regular, '2026-12-04'), true);
  assert.equal(billArchiveDeleteDate(regular), '2026-12-11');
  assert.equal(billArchiveDeleteDate({ ...regular, date: '2026-12-20', settled: '2026-12-11' }), '2026-12-26');
  const late = { ...regular, date: '2026-12-09', settled: '2026-12-09' };
  assert.equal(billArchiveDeleteDate(late), '2026-12-13');
  const original = state([{ id: 'balance', type: 'balance', date: '2026-11-30', amount: 474400, stamp: 1 }, regular], { reserveBills: true });
  const before = budget(original, '2026-12-11').current;
  const cleaned = maintainBudget(original, '2026-12-11');
  assert.equal(cleaned.records.length, 1);
  assert.equal(cleaned.records[0].billCarry, 100000);
  assert.equal(budget(cleaned, '2026-12-11').current, before);
  assert.equal(cleaned.reserveBills, true);
  assert.equal(maintainBudget(cleaned, '2026-12-12'), cleaned);
  const unpaid = state([{ ...regular, settled: null }]);
  assert.equal(maintainBudget(unpaid, '2027-01-01'), unpaid);
  assert.equal(findPaidBillDuplicate([regular], '  КРЕДИТ  ', 100000), regular);
  assert.equal(findPaidBillDuplicate([regular], 'Кредит', 200000), null);
  assert.equal(findPaidBillDuplicate(unpaid.records, 'Кредит', 100000), null);
});

test('bill urgency and push windows respect lead time and exclude paid and overdue rows', () => {
  const today = '2026-11-21';
  assert.equal(billUrgency('2026-11-24', today), 'green');
  assert.equal(billUrgency('2026-11-23', today), 'yellow');
  assert.equal(billUrgency('2026-11-22', today), 'yellow');
  assert.equal(billUrgency(today, today), 'red');
  assert.equal(billUrgency('2026-11-20', today), 'red');
  assert.equal(billUrgency('2026-11-25', today), null);
  const rows = [
    { id: 'tomorrow', type: 'bill', date: '2026-11-22' },
    { id: 'today', type: 'bill', date: today, remind: 0 },
    { id: 'future', type: 'bill', date: '2026-11-25', remind: 3 },
    { id: 'paid', type: 'bill', date: '2026-11-22', settled: today },
    { id: 'overdue', type: 'bill', date: '2026-11-20' },
  ];
  assert.deepEqual(upcomingBudgetBills({ records: rows }, today).map(row => row.id), ['tomorrow', 'today']);
  assert.equal(normalizeBudget({ daily: 0, records: [], reserveBills: true }).reserveBills, true);
});

test('budget push claim is private, retries safely and survives clearing the notification', { skip: !process.env.PGLITE_MODULE }, async () => {
  const { PGlite } = await import(process.env.PGLITE_MODULE);
  const db = new PGlite();
  const owner = '00000000-0000-0000-0000-000000000001';
  const user = '00000000-0000-0000-0000-000000000002';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      insert into auth.users values('${owner}'),('${user}');
      create table profiles(user_id uuid primary key,role text);
      insert into profiles values('${owner}','owner'),('${user}','user');
      create table user_notifications(id bigserial primary key,user_id uuid,type text,title text,body text,url text,expires_at timestamptz);
      create schema vault; create schema cron;
      create table vault.decrypted_secrets(name text,decrypted_secret text);
      insert into vault.decrypted_secrets values('alvisa_egais_cron_secret','test-only-secret-value'),
        ('alvisa_egais_reminder_anon_key','test-only-key-value'),('alvisa_egais_reminder_project_url','https://test.invalid');
      create table cron.job(jobid bigint generated always as identity primary key,jobname text,schedule text,command text);
      create function cron.schedule(text,text,text) returns bigint language sql as $$insert into cron.job(jobname,schedule,command) values($1,$2,$3) returning jobid$$;
      create function cron.unschedule(bigint) returns boolean language sql as $$delete from cron.job where jobid=$1 returning true$$;`);
    const sql = await read('supabase-sql/079_budget_bill_push.sql');
    await db.exec(sql); await db.exec(sql);
    assert.equal((await db.query('select * from cron.job')).rows.length, 1);
    await db.exec('set role authenticated');
    await assert.rejects(db.query(`select * from claim_budget_bill_reminder('${owner}')`), /permission denied/);
    await assert.rejects(db.query('select * from budget_bill_push_days'), /permission denied/);
    await db.exec('reset role; set role service_role');
    assert.equal((await db.query(`select * from claim_budget_bill_reminder('${user}')`)).rows.length, 0);
    const claimed = (await db.query(`select * from claim_budget_bill_reminder('${owner}')`)).rows[0];
    assert.ok(claimed.notification_id);
    assert.equal((await db.query(`select * from claim_budget_bill_reminder('${owner}')`)).rows.length, 0);
    await db.exec("update budget_bill_push_days set claimed_at=now()-interval '10 minutes'");
    assert.equal((await db.query(`select * from claim_budget_bill_reminder('${owner}')`)).rows[0].notification_id, claimed.notification_id);
    await db.exec('update budget_bill_push_days set delivered_at=now(); reset role; delete from user_notifications; set role service_role');
    assert.equal((await db.query(`select * from claim_budget_bill_reminder('${owner}')`)).rows.length, 0);
    await db.exec('reset role');
    assert.equal((await db.query('select count(*)::int as count from user_notifications')).rows[0].count, 0);
  } finally { await db.close(); }
});

test('today closing balance is repaired durably and newer snapshots take priority', () => {
  const data = state([
    { id: 'snapshot', type: 'balance', date: '2026-11-21', amount: 474400, closed: true, stamp: 10 },
    { type: 'expense', date: '2026-11-21', amount: 100000, stamp: 9 },
    { type: 'expense', date: '2026-11-21', amount: 50000, stamp: 11 },
    { type: 'bill', date: '2026-11-25', amount: 100000, settled: '2026-11-21', settledStamp: 12 },
  ]);
  const repaired = repairCurrentDayBalances(data, '2026-11-21');
  assert.equal(repaired.records[0].closed, false);
  assert.equal(budget(repaired, '2026-11-21').current, 324400);
  assert.equal(budget(repaired, '2026-11-22').current, 324400);
  assert.equal(repairCurrentDayBalances(data, '2026-11-22'), data);
  const records = [data.records[0], { id: 'new', type: 'balance', date: '2026-11-21', amount: 900000, stamp: 20 }];
  assert.equal(budget(state(records), '2026-11-21').current, 900000);
});

test('deleting month-old expenses preserves balance, snapshots, and legacy Finance arithmetic', () => {
  const data = state([
    { id: 'snapshot', type: 'balance', date: '2026-10-20', amount: 474400, stamp: 1 },
    { id: 'old', type: 'expense', date: '2026-10-21', amount: 50000, category: 'Продукты', stamp: 2, archived: true },
    { id: 'recent', type: 'expense', date: '2026-11-21', amount: 10000, category: 'Дом', stamp: 3 },
  ]);
  const before = budget(data, '2026-11-21').current;
  const cleaned = maintainBudget(data, '2026-11-21');
  assert.equal(before, 414400);
  assert.equal(budget(cleaned, '2026-11-21').current, before);
  assert.equal(cleaned.records.length, 2);
  assert.equal(cleaned.records[0].amount, 424400);
  assert.equal(cleaned.records[0].expenseCarry, 50000);
  assert.equal(cleaned.expenseHistoryFrom, '2026-10-22');
  assert.equal(maintainBudget(cleaned, '2026-11-21'), cleaned);
  assert.equal(cleaned.records[0].amount - cleaned.records[1].amount, before);
  const newer = { id: 'new', type: 'balance', date: '2026-11-21', amount: 300000, stamp: 4 };
  assert.equal(budget({ ...cleaned, records: [...cleaned.records, newer] }, '2026-11-21').current, 300000);
  const second = maintainBudget({ ...data, records: [...data.records, newer] }, '2026-11-21');
  assert.equal(budget({ ...second, records: second.records.filter(row => row.id !== 'new') }, '2026-11-21').current, before);
});

test('calendar month retention clamps month ends and daily archiving never alters money', () => {
  const data = state([
    { id: 'b', type: 'balance', date: '2027-01-30', amount: 100000, stamp: 1 },
    { id: 'a', type: 'expense', date: '2027-01-31', amount: 10000, stamp: 2 },
    { id: 'c', type: 'expense', date: '2027-01-31', amount: 20000, stamp: 3 },
  ]);
  assert.equal(maintainBudget(data, '2027-02-27'), data);
  assert.equal(maintainBudget(data, '2027-02-28').records.length, 1);
  assert.equal(budget(maintainBudget(data, '2027-02-28'), '2027-02-28').current, 70000);
  const archived = archiveExpenseDay(data, '2027-01-31', true);
  assert.equal(expenseDays(archived.records).length, 1);
  assert.equal(expenseDays(archived.records)[0].amount, 30000);
  assert.equal(budget(archived, '2027-02-01').current, budget(data, '2027-02-01').current);
  assert.equal(archiveExpenseDay(archived, '2027-01-31', false).records[1].archived, false);
});

test("existing Finance state loads without migration and preserves extra fields", () => {
  const legacy = state([
    { id: "a", type: "balance", date: "2026-11-19", amount: 1000000, closed: true, stamp: 10 },
    { id: "b", type: "expense", date: "2026-11-20", amount: 50000, category: "Лень считать", stamp: 13 },
    { id: "c", type: "bill", date: "2026-11-20", amount: 100000, settled: "2026-11-20", futureField: 1 },
  ], { futureSetting: { value: 42 } });
  const loaded = normalizeBudget(legacy);
  assert.equal(loaded.people, 2);
  assert.deepEqual(loaded.futureSetting, legacy.futureSetting);
  assert.deepEqual(loaded.records, legacy.records);
  assert.equal(budget(loaded, "2026-11-21").current, 850000);
  assert.equal(normalizeBudget({ ...legacy, people: 5 }).people, 5);
  for (const raw of [null, {}, { records: [], daily: -1 }, { ...legacy, people: 0 }, state([{ type: "expense", date: "2026-02-30", amount: 100 }])]) {
    assert.throws(() => normalizeBudget(raw));
  }
  assert.equal(validDate("2026-02-30"), false);
});

test("closing checkpoint excludes same-day operations and reserves bills strictly before payday", () => {
  const records = [
    { type: "balance", date: "2026-11-19", closed: true, amount: 1000000, stamp: 10 },
    { type: "income", date: "2026-11-19", settled: "2026-11-19", amount: 300000, settledStamp: 20 },
    { type: "expense", date: "2026-11-19", amount: 100000, stamp: 12 },
    { type: "expense", date: "2026-11-20", amount: 50000, stamp: 13 },
    { type: "bill", date: "2026-11-20", settled: "2026-11-20", amount: 100000 },
    { type: "bill", date: "2026-11-25", amount: 200000 },
    { type: "bill", date: "2026-11-26", amount: 900000 },
    { type: "bill", date: "2026-11-01", amount: 50000 },
  ];
  const result = budget(state(records, { reserveBills: true }), "2026-11-21");
  assert.equal(result.current, 850000);
  assert.equal(result.reserve, 50000);
  assert.equal(result.paydayReserve, 200000);
  assert.equal(result.days, 4);
  assert.equal(result.forecastBefore, 600000);
  assert.equal(result.forecast, 600000);
});

test("payday bill is covered by that day's income, not deducted twice from today's funds", () => {
  const data = state([
    { type: "balance", date: "2026-11-21", amount: 474400, stamp: 1 },
    { type: "bill", date: "2026-11-25", amount: 1000000 },
  ], { daily: 0, reserveBills: true });
  const payment = [{ nominal: "2026-11-25", date: "2026-11-25", amount: 2500000 }];
  const result = budget(data, "2026-11-21", payment);
  assert.equal(result.current, 474400);
  assert.equal(result.free, 474400);
  assert.equal(result.forecastBefore, 474400);
  assert.equal(result.forecast, 474400);
  data.records[1].date = "2026-11-24";
  const earlier = budget(data, "2026-11-21", payment);
  assert.equal(earlier.free, -525600);
  assert.equal(earlier.forecast, -525600);
  assert.equal(budget(data, "2026-11-21").forecast, -525600);
});

test("slider never spends unreceived Salary, even when that forecast is much larger", () => {
  const data = state([{ type: "balance", date: "2026-11-21", amount: 474400, stamp: 1 }], { daily: 500000 });
  assert.equal(budget(data, "2026-11-21", [{ nominal: "2026-11-25", date: "2026-11-25", amount: 4353546 }]).forecast, -1525600);
});

test('automatic daily maximum uses dates and reserve mode without double-counting payments', () => {
  const data = state([
    { id: 'balance', type: 'balance', date: '2026-11-25', amount: 5000000, stamp: 10 },
    { type: 'income', nominal: '2026-11-25', date: '2026-11-25', amount: 5000000, settled: '2026-11-25', settledStamp: 9 },
    { type: 'bill', date: '2026-12-05', amount: 3000000 },
  ]);
  let result = budget(data, '2026-11-25');
  let limit = dailySpendingLimit(result, 2);
  assert.equal(Math.round(result.free - limit.total * limit.days), 0);
  assert.equal(result.free, 5000000);
  assert.equal(limit.perPerson, 5000000 / 15 / 2);
  data.reserveBills = true;
  result = budget(data, '2026-11-25');
  limit = dailySpendingLimit(result, 2);
  assert.equal(result.free, 2000000);
  assert.equal(limit.perPerson, 2000000 / 15 / 2);
  assert.ok(dailySpendingLimit(budget(data, '2026-11-26'), 2).perPerson > limit.perPerson);
  data.records[2] = { ...data.records[2], settled: '2026-11-25', settledStamp: 11 };
  assert.equal(budget(data, '2026-11-25').current, 2000000);
  assert.equal(budget(data, '2026-11-25').free, 2000000);
  data.records.push({ type: 'expense', date: '2026-11-25', amount: 100000, stamp: 12 });
  assert.ok(dailySpendingLimit(budget(data, '2026-11-25'), 2).perPerson < limit.perPerson);
});

test("bill cycles use actual months and year boundaries", () => {
  assert.deepEqual(billPeriodRange("2026-11-25"), { start: "2026-11-25", end: "2026-12-10" });
  assert.deepEqual(billPeriodRange("2026-12-09"), { start: "2026-11-25", end: "2026-12-10" });
  assert.deepEqual(billPeriodRange("2026-12-10"), { start: "2026-12-10", end: "2026-12-25" });
  assert.deepEqual(billPeriodRange("2027-01-01"), { start: "2026-12-25", end: "2027-01-10" });
});

test("income cycle excludes the opening 10th and includes the next month's final salary", () => {
  const rows = [
    { nominal: '2026-11-10', date: '2026-11-10', amount: 1619988 },
    { nominal: '2026-11-25', date: '2026-11-25', amount: 2500000 },
    { nominal: '2026-12-10', date: '2026-12-09', amount: 3000000 },
    { nominal: '2026-12-25', date: '2026-12-25', amount: 9000000 },
  ];
  assert.deepEqual(budgetIncomeCycle('2026-11-21'), { start: '2026-11-10', end: '2026-12-10' });
  assert.deepEqual(cycleIncomes(rows, '2026-11-21'), rows.slice(1, 3));
  assert.deepEqual(budgetIncomeCycle('2027-01-09'), { start: '2026-12-10', end: '2027-01-10' });
});

test("next advance appears only for an unpaid bill on or after the following 25th", () => {
  const next = { nominal: '2026-12-25', date: '2026-12-24', amount: 1500000 };
  assert.equal(nextBudgetIncome([next], [{ type: 'bill', date: '2026-12-24' }], '2026-11-21'), null);
  assert.equal(nextBudgetIncome([next], [{ type: 'bill', date: '2026-12-25' }], '2026-11-21'), next);
  assert.equal(nextBudgetIncome([next], [{ type: 'bill', date: '2027-01-15' }], '2026-11-21'), next);
  assert.equal(nextBudgetIncome([next], [{ type: 'bill', date: '2026-12-25', settled: '2026-11-21' }], '2026-11-21'), null);
});

test("auto salary credits once at Moscow 10:00 and honors overrides, cancellations and unknown amounts", () => {
  const data = state([{ type: "balance", date: "2026-11-24", amount: 10000, stamp: 1 }], { salaryAutoStart: "2026-11-21" });
  const salary = [{ nominal: "2026-11-25", date: "2026-11-25", amount: 30000 }];
  assert.equal(receiveDueSalary(data, salary, new Date("2026-11-25T06:59:59Z")), data);
  const next = receiveDueSalary(data, salary, new Date("2026-11-25T07:00:00Z"));
  assert.equal(budget(next, "2026-11-25").current, 40000);
  assert.equal(next.records.at(-1).settledStamp, Date.parse("2026-11-25T07:00:00Z"));
  assert.equal(receiveDueSalary(next, salary, new Date("2026-11-26T07:00:00Z")), next);
  const manual = { type: "income", nominal: "2026-11-25", date: "2026-11-26", amount: 50000, override: true };
  const changed = state([...data.records, manual], { salaryAutoStart: "2026-11-21" });
  assert.equal(receiveDueSalary(changed, salary, new Date("2026-11-25T08:00:00Z")), changed);
  assert.equal(receiveDueSalary(changed, salary, new Date("2026-11-26T07:00:00Z")).records.at(-1).amount, 50000);
  const cancelled = state([...data.records, { ...manual, date: "2026-11-25", autoSkipped: true }], { salaryAutoStart: "2026-11-21" });
  assert.equal(receiveDueSalary(cancelled, salary, new Date("2026-11-25T08:00:00Z")), cancelled);
  assert.equal(receiveDueSalary(data, [], new Date("2026-11-25T08:00:00Z")), data);
});

test("late auto-credit does not double count money already included in a balance checkpoint", () => {
  const payment = [{ nominal: "2026-11-25", date: "2026-11-25", amount: 30000 }];
  const snapshot = { type: "balance", date: "2026-11-25", amount: 10000, stamp: Date.parse("2026-11-25T08:00:00Z") };
  const data = state([snapshot], { salaryAutoStart: "2026-11-21" });
  const credited = receiveDueSalary(data, payment, new Date("2026-11-25T09:00:00Z"));
  assert.equal(budget(credited, "2026-11-25").current, 10000);
  snapshot.stamp = Date.parse("2026-11-25T06:00:00Z");
  assert.equal(budget(receiveDueSalary(data, payment, new Date("2026-11-25T09:00:00Z")), "2026-11-25").current, 40000);
  const enabledToday = receiveDueSalary(state([]), payment, new Date("2026-11-26T09:00:00Z"));
  assert.equal(enabledToday.records.length, 0);
});

test("budget derives absent paySummary using saved hours, snapshot salary, norm, and tax", async () => {
  const payload = { year: 2026, month: 10,
    dayHours: Array.from({ length: 30 }, (_, i) => i < 15 ? 8 : 0), nightHours: Array(30).fill(0),
    moneySnapshot: { okladSnapshot: 60000, effectiveOkladSnapshot: 60000 },
    normSnapshot: { baseDayHours: 8 },
  };
  const calculated = calculateBudgetPayments(payload, { oklad: 999999, tax_rate: .13 });
  assert.ok(calculated.advance > 0 && calculated.remaining > 0);
  const calendar = async () => ({ version: "test", isHoliday: Array(31).fill(false), isTransferredOff: Array(31).fill(false) });
  const rows = [{ year: 2026, month: 10, payload }];
  const payments = await buildBudgetSalary(rows, "2026-11-21", "chateau_alvisa", calendar, { oklad: 999999, tax_rate: .13 });
  assert.equal(payments.find(r => r.nominal === "2026-11-25").amount, Math.round(calculated.advance * 100));
  assert.equal(payments.find(r => r.nominal === "2026-12-10").amount, Math.round(calculated.remaining * 100));
  payload.paySummary = { actual: { advance: 17000, confirmedAt: "now" } };
  const confirmed = await buildBudgetSalary(rows, "2026-11-21", "chateau_alvisa", calendar, {});
  assert.equal(confirmed.find(r => r.nominal === "2026-11-25").amount, 1700000);
  assert.equal(calculateBudgetPayments(null), null);
  assert.equal(calculateBudgetPayments({ ...payload, moneySnapshot: null }, {}), null);
});

test("instant checkpoint accounts only later operations, including received income, without double counting forecasts", () => {
  const records = [
    { id: "snapshot", type: "balance", date: "2026-11-21", amount: 10000, stamp: 10 },
    { type: "expense", date: "2026-11-21", amount: 3000, stamp: 9 },
    { type: "expense", date: "2026-11-21", amount: 2000, stamp: 11 },
    { type: "income", date: "2026-11-25", nominal: "2026-11-25", amount: 5000, settled: "2026-11-21", settledStamp: 12 },
    { type: "income", date: "2026-11-10", amount: 8000, settled: "2026-11-21", settledStamp: 8 },
  ];
  const forecast = [{ nominal: "2026-11-25", date: "2026-11-25", amount: 999999 }];
  assert.equal(budget(state(records), "2026-11-21", forecast).current, 13000);
  assert.equal(budget(state([{ ...records[0], amount: 12000 }, ...records.slice(1)]), "2026-11-21", forecast).current, 15000);
  const closed = [{ ...records[0], closed: true }, ...records.slice(1)];
  assert.equal(budget(state(closed), "2026-11-21", forecast).current, 10000);
  assert.equal(budget(state([]), "2026-11-21", forecast).current, null);
});

test("manual dates, amounts, and received flags survive repeated Salary refreshes", () => {
  const nominal = "2026-11-25";
  const salary = [{ nominal, date: "2026-11-25", amount: 300000 }];
  for (const edit of [{ override: true, date: "2026-11-24" }, { settled: "2026-11-20", settledStamp: 15 }]) {
    const row = { id: "payment", type: "income", nominal, date: "2026-11-25", amount: 200000, ...edit };
    const output = scheduled("2026-11-21", [row], salary).filter((r) => r.nominal === nominal);
    assert.deepEqual(output, [row]);
  }
  const automatic = { id: "payment", type: "income", nominal, date: "2026-11-25", amount: 200000 };
  assert.equal(scheduled("2026-11-21", [automatic], salary).find((r) => r.nominal === nominal).amount, 300000);
});

test("lazy expenses reduce balance and monthly total, but not category breakdown", () => {
  const data = state([
    { type: "expense", date: "2026-11-20", category: "Лень считать", amount: 1000 },
    { type: "expense", date: "2026-11-20", category: "Продукты", amount: 2000 },
    { type: "expense", date: "2026-10-20", category: "Продукты", amount: 9000 },
    { type: "bill", date: "2026-10-20", settled: "2026-11-01", amount: 5000 },
  ]);
  const result = monthlyExpenses(data, "2026-11");
  assert.equal(result.total, 8000);
  assert.equal(result.unclassified, 1000);
  assert.equal(result.paid, 5000);
  assert.equal(result.breakdown.reduce((sum, [, amount]) => sum + amount, 0), 2000);
  assert.ok(!result.breakdown.some(([name]) => name === "Лень считать"));
});

test("confirmed Salary values including zero override forecasts; unconfirmed actuals do not", () => {
  assert.equal(salaryAmount({ paySummary: { calculated: { advance: "12500.65" } } }, "advance"), 1250065);
  assert.equal(salaryAmount({ paySummary: { actual: { confirmedAt: "now", advance: 0 }, calculated: { advance: 500 } } }, "advance"), 0);
  assert.equal(salaryAmount({ paySummary: { actual: { advance: 100 }, calculated: { advance: 500 } } }, "advance"), 50000);
  assert.equal(salaryAmount({ paySummary: { remaining: 400 } }, "remaining"), 40000);
  assert.equal(salaryAmount(null, "advance"), undefined);
});

test("Salary calendar moves January payment across year boundary and uses previous month's confirmed remainder", async () => {
  const loadCalendar = async (year, month) => ({
    version: "fixture", isHoliday: Array.from({ length: 31 }, (_, i) => year === 2026 && month === 0 && i < 8),
    isTransferredOff: Array.from({ length: 31 }, (_, i) => (year === 2026 && month === 0 && i === 8) || (year === 2025 && month === 11 && i === 30)),
  });
  const result = await buildBudgetSalary([
    { year: 2025, month: 11, payload: { paySummary: { actual: { remaining: 34000, confirmedAt: "now" }, calculated: { remaining: 32000 } } } },
    { year: 2026, month: 0, payload: { paySummary: { calculated: { advance: 12500.65 } } } },
  ], "2026-01-01", "chateau_alvisa", loadCalendar);
  const remainder = result.find((r) => r.nominal === "2026-01-10");
  assert.equal(remainder.date, "2025-12-30");
  assert.equal(remainder.amount, 3400000);
  assert.equal(remainder.confirmed, true);
  assert.equal(result.find((r) => r.nominal === "2026-01-25").date, "2026-01-23");
  assert.deepEqual(salaryMonths("2026-01-01").slice(0, 2), [{ year: 2025, month: 11 }, { year: 2026, month: 0 }]);
});

test("shared payday resolver and regional calendar agree with personal timesheet", async () => {
  const result = await buildBudgetSalary([], "2026-05-01", "chateau_alvisa");
  assert.equal(result.find((r) => r.nominal === "2026-05-10").date, "2026-05-08");
  const raw = new Date(2026, 0, 10);
  const moved = await resolvePaymentDate(raw, async (date) => [0, 6].includes(date.getDay()));
  assert.equal(moved.getDate(), 9);
  assert.equal(raw.getDate(), 10);
  assert.match(await read("js/table.js"), /return resolveCalendarPaymentDate\(rawDate, isPaymentNonWorkingDate\)/);
});

test("budget page uses Salary session and owner navigation, never Finance browser storage", async () => {
  const source = await read("js/budget.js");
  assert.match(source, /await requireSession\(\)/);
  assert.match(source, /profile\?\.role !== "owner"/);
  assert.match(source, /createMoneyAccessGuard/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|readCloud|cloudBudget|importSalary/);
  assert.match(await read("js/nav.js"), /const OWNER_LINKS = \[\s*\{ key: "budget"/);
});

test("budget RLS preserves existing rows, isolates owners, rejects others and supports revision compare-and-swap", { skip: !process.env.PGLITE_MODULE }, async () => {
  const { PGlite } = await import(process.env.PGLITE_MODULE);
  const db = new PGlite();
  const owner = "00000000-0000-0000-0000-000000000001";
  const second = "00000000-0000-0000-0000-000000000002";
  const user = "00000000-0000-0000-0000-000000000003";
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      grant usage on schema auth to authenticated;
      create table auth.users(id uuid primary key);
      insert into auth.users values ('${owner}'),('${second}'),('${user}');
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function public.is_owner() returns boolean language sql stable as $$select auth.uid() in ('${owner}'::uuid,'${second}'::uuid)$$;
      create table finance_budgets(user_id uuid primary key references auth.users(id),state jsonb not null,revision int not null default 0);
      insert into finance_budgets values ('${owner}','{"daily":0,"records":[],"people":3}',8),('${second}','{"daily":100,"records":[]}',2);
      alter table finance_budgets enable row level security;
      create policy legacy_allow on finance_budgets for all to authenticated using(true) with check(true);`);
    const sql = await read("supabase-sql/077_finance_budget_access.sql");
    await db.exec(sql); await db.exec(sql);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`);
    assert.deepEqual((await db.query("select revision,state from finance_budgets")).rows, [{ revision: 8, state: { daily: 0, records: [], people: 3 } }]);
    assert.equal((await db.query(`update finance_budgets set revision=9 where revision=8 returning revision`)).rows.length, 1);
    assert.equal((await db.query(`update finance_budgets set revision=9 where revision=8 returning revision`)).rows.length, 0);
    await assert.rejects(db.query(`update finance_budgets set user_id='${user}'`), /row-level security/);
    await assert.rejects(db.query("delete from finance_budgets"), /permission denied/);
    await db.exec(`select set_config('request.jwt.claim.sub','${user}',false);`);
    assert.equal((await db.query("select * from finance_budgets")).rows.length, 0);
    await assert.rejects(db.query(`insert into finance_budgets values('${user}','{"daily":0,"records":[]}',0)`), /row-level security/);
    await db.exec("reset role; set role anon;");
    await assert.rejects(db.query("select * from finance_budgets"), /permission denied/);
  } finally { await db.close(); }
});

test("salary cron is idempotent, initializes owners only and keeps existing budget data", { skip: !process.env.PGLITE_MODULE }, async () => {
  const { PGlite } = await import(process.env.PGLITE_MODULE);
  const db = new PGlite();
  try {
    await db.exec(`create schema vault; create schema cron;
      create table vault.decrypted_secrets(name text, decrypted_secret text);
      insert into vault.decrypted_secrets values ('alvisa_egais_cron_secret','test-only-not-a-secret'),
        ('alvisa_egais_reminder_anon_key','test-only-public-key'),('alvisa_egais_reminder_project_url','https://test.invalid');
      create table cron.job(jobid bigint generated always as identity primary key,jobname text,schedule text,command text);
      create function cron.schedule(text,text,text) returns bigint language sql as $$insert into cron.job(jobname,schedule,command) values($1,$2,$3) returning jobid$$;
      create function cron.unschedule(bigint) returns boolean language sql as $$delete from cron.job where jobid=$1 returning true$$;
      create table profiles(user_id int primary key, role text);
      insert into profiles values(1,'owner'),(2,'user');
      create table finance_budgets(user_id int primary key,state jsonb,revision int);
      insert into finance_budgets values(1,'{"daily":500,"records":[]}',8),(2,'{"daily":100,"records":[]}',3);`);
    const sql = await read('supabase-sql/078_budget_salary_cron.sql');
    await db.exec(sql); await db.exec(sql);
    const rows = (await db.query('select * from finance_budgets order by user_id')).rows;
    assert.equal(rows[0].revision, 9);
    assert.equal(rows[0].state.daily, 500);
    assert.ok(validDate(rows[0].state.salaryAutoStart));
    assert.deepEqual(rows[1].state, { daily: 100, records: [] });
    const jobs = (await db.query('select * from cron.job')).rows;
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].schedule, '0 7-20 * * *');
    assert.match(jobs[0].command, /x-cron-secret/);
    assert.match(jobs[0].command, /credit-budget-salary/);
    const edge = await read('supabase/functions/credit-budget-salary/index.ts');
    assert.match(edge, /matchesSecret\(request.headers.get\("x-cron-secret"\)/);
    assert.match(edge, /eq\("role", "owner"\)/);
    assert.match(edge, /eq\("revision", row.revision\)/);
  } finally { await db.close(); }
});
