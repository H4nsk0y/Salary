import { budget, dailySpendingLimit } from "./budgetModel.js?v=20261123-1";

export function spentOnDay(state, date) {
  return state.records.filter(row => row.type === "expense" && row.date === date)
    .reduce((total, row) => total + row.amount, 0);
}

function dayAnchor(state, today, salary) {
  if (state.dailySpendingAnchor?.date === today) return state.dailySpendingAnchor;
  const result = budget(state, today, salary);
  if (result.current === null || !result.next) return null;
  // Undo today's purchases only. Bills and received income remain real cash flows.
  const opening = result.current + spentOnDay(state, today);
  const total = Math.floor(dailySpendingLimit({ ...result, free: opening }, 1).total);
  const reservedTotal = Math.floor(dailySpendingLimit({ ...result, free: opening - result.reserve }, 1).total);
  if (![total, reservedTotal].every(Number.isSafeInteger)) return null;
  return { date: today, total, reservedTotal, estimated: spentOnDay(state, today) > 0 };
}

export function preserveDailySpendingAnchor(before, next, today, salary = []) {
  if (!before.records.some(row => row.type === "expense" && row.date === today) &&
      !next.records.some(row => row.type === "expense" && row.date === today)) return next;
  const anchor = dayAnchor(before, today, salary) ?? dayAnchor(next, today, salary);
  return anchor ? { ...next, dailySpendingAnchor: anchor } : next;
}

export function dailyExpenseSummary(state, today, salary = []) {
  const spent = spentOnDay(state, today);
  const anchor = dayAnchor(state, today, salary);
  const result = budget(state, today, salary);
  if (!anchor || result.current === null) return { spent, available: null, exceeded: 0, cashLimited: false, estimated: false };
  const limit = state.reserveBills ? anchor.reservedTotal : anchor.total;
  const remainder = limit - spent;
  const cash = Math.max(0, result.free);
  return {
    spent,
    available: Math.max(0, Math.min(remainder, cash)),
    exceeded: Math.max(0, -remainder),
    cashLimited: remainder > cash,
    estimated: Boolean(anchor.estimated),
  };
}
