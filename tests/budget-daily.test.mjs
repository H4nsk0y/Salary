import assert from 'node:assert/strict';
import test from 'node:test';
import { budget, normalizeBudget } from '../js/features/budgetModel.js';
import { dailyExpenseSummary, preserveDailySpendingAnchor, spentOnDay } from '../js/features/budgetDaily.js';

const today = '2026-11-22';
const initial = extra => ({ daily: 0, people: 2, reserveBills: false, records: [
  { id: 'balance', type: 'balance', date: '2026-11-21', amount: 300000, stamp: 1 },
], ...extra });
const expense = (amount, id = 'purchase') => ({ id, type: 'expense', date: today, amount, stamp: 10 });
const add = (state, row, date = today) => preserveDailySpendingAnchor(state, { ...state, records: [...state.records, row] }, date);
const summary = state => dailyExpenseSummary(state, today);

test('first purchase freezes the total limit, not the recalculated remaining balance', () => {
  let state = add(initial(), expense(15000));
  assert.equal(state.dailySpendingAnchor.total, 100000);
  assert.equal(state.dailySpendingAnchor.estimated, false);
  for (const [index, amount] of [30000,13600,3000,14600].entries()) state = add(state, expense(amount, String(index)));
  assert.equal(summary(state).spent, 76200);
  assert.equal(summary(state).available, 23800);
  assert.equal(summary(state).exceeded, 0);
  assert.equal(state.dailySpendingAnchor.total, 100000);
});

test('overspending, editing and deleting purchases preserve the initial allowance', () => {
  const first = add(initial(), expense(50000));
  const edited = preserveDailySpendingAnchor(first, { ...first, records: first.records.map(row => row.type === 'expense' ? { ...row, amount: 120000 } : row) }, today);
  assert.equal(summary(edited).exceeded, 20000);
  const deleted = preserveDailySpendingAnchor(edited, { ...edited, records: edited.records.filter(row => row.type !== 'expense') }, today);
  assert.equal(summary(deleted).available, 100000);
  assert.equal(summary(add(deleted, expense(10000))).available, 90000);
});

test('both reserve modes use frozen allowances and paying a reserved bill is not counted twice', () => {
  const base = initial();
  base.records.push({ id: 'bill', type: 'bill', date: '2026-11-24', amount: 60000, stamp: 2 });
  const state = add({ ...base, reserveBills: true }, expense(15000));
  assert.equal(summary(state).available, 65000);
  assert.equal(summary({ ...state, reserveBills: false }).available, 85000);
  const paid = preserveDailySpendingAnchor(state, { ...state, records: state.records.map(row => row.type === 'bill' ? { ...row, settled: today, settledStamp: 12 } : row) }, today);
  assert.equal(summary(paid).spent, 15000);
  assert.equal(summary(paid).available, 65000);
  assert.equal(summary({ ...paid, reserveBills: false }).available, 85000);
});

test('without a reserve, a large bill limits available cash but is not daily overspending', () => {
  const base = initial();
  base.records.push({ id: 'bill', type: 'bill', date: '2026-11-24', amount: 275000, stamp: 2 });
  const first = add(base, expense(15000));
  const paid = preserveDailySpendingAnchor(first, { ...first, records: first.records.map(row => row.type === 'bill' ? { ...row, settled: today, settledStamp: 12 } : row) }, today);
  assert.equal(budget(paid, today).current, 10000);
  assert.equal(summary(paid).spent, 15000);
  assert.equal(summary(paid).available, 10000);
  assert.equal(summary(paid).cashLimited, true);
  assert.equal(summary(paid).exceeded, 0);
  const undo = { ...paid, records: paid.records.map(row => row.type === 'bill' ? { ...row, settled: null } : row) };
  assert.equal(summary(undo).available, 85000);
});

test('income and balance corrections after the first purchase do not inflate the fixed limit', () => {
  const state = add(initial(), expense(76200));
  const paid = add(state, { id: 'income', type: 'income', date: today, settled: today, amount: 500000, stamp: 20, settledStamp: 20 });
  assert.equal(summary(paid).available, 23800);
  const reconciled = add(paid, { id: 'balance-new', type: 'balance', date: today, amount: 10000, stamp: 21 });
  assert.equal(summary(reconciled).spent, 76200);
  assert.equal(summary(reconciled).available, 10000);
});

test('the next day starts from remaining money and fewer days; household size does not duplicate allowance', () => {
  const first = add(initial(), expense(76200));
  assert.equal(dailyExpenseSummary({ ...first, people: 5 }, today).available, 23800);
  const tomorrow = '2026-11-23';
  assert.equal(dailyExpenseSummary(first, tomorrow).spent, 0);
  assert.equal(dailyExpenseSummary(first, tomorrow).available, 111900);
  const next = add(first, { ...expense(10000), date: tomorrow, stamp: 20 }, tomorrow);
  assert.equal(next.dailySpendingAnchor.date, tomorrow);
  assert.equal(next.dailySpendingAnchor.total, 111900);
  assert.equal(dailyExpenseSummary(next, tomorrow).available, 101900);
});

test('legacy purchases are reconstructed without altering records and archived purchases still count', () => {
  const state = initial();
  state.records.push({ ...expense(76200), archived: true });
  assert.equal(spentOnDay(state, today), 76200);
  assert.equal(summary(state).available, 23800);
  assert.equal(summary(state).estimated, true);
  assert.equal(state.dailySpendingAnchor, undefined);
  const next = add(state, expense(10000, 'new'));
  assert.equal(next.dailySpendingAnchor.total, 100000);
  assert.equal(summary(next).available, 13800);
});

test('unrecorded balances stay unknown and checkpoints do not cause double subtraction', () => {
  const unknown = { daily: 0, people: 2, records: [expense(76200)] };
  assert.equal(summary(unknown).available, null);
  const checkpoint = initial({ records: [{ id: 'balance', type: 'balance', date: today, amount: 223800, stamp: 20 }, expense(76200)] });
  assert.equal(summary(checkpoint).available, 23800);
});

test('normalization accepts old cloud budgets, preserves valid anchors and rejects corrupt ones', () => {
  assert.equal(normalizeBudget(initial()).dailySpendingAnchor, undefined);
  const state = add(initial(), expense(10000));
  const restored = normalizeBudget(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(summary(restored), summary(state));
  for (const anchor of [ {}, { date: today, total: -1, reservedTotal: 0 }, { date: today, total: 100, reservedTotal: 101 }, { date: '2026-02-31', total: 100, reservedTotal: 0 }, { date: today, total: 1.5, reservedTotal: 0 }, { date: today, total: 100, reservedTotal: 0, estimated: 'yes' } ]) {
    assert.throws(() => normalizeBudget({ ...initial(), dailySpendingAnchor: anchor }), /дневной ориентир/);
  }
});
