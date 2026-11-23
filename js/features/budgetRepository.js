import { loadMyBudget, saveMyBudget, BudgetConflict } from '../db.js';
import { normalizeBudget, newBudget, maintainBudget, todayISO } from './budgetModel.js?v=20261123-1';

export async function saveBudgetSnapshot(state, revision) {
  const next = normalizeBudget(maintainBudget(normalizeBudget(state), todayISO()));
  const saved = await saveMyBudget(next, revision);
  return { state: next, revision: saved.revision };
}

export async function loadBudgetSnapshot() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await loadMyBudget();
    const loaded = normalizeBudget(row?.state ?? newBudget());
    let next = maintainBudget(loaded, todayISO());
    let revision = row?.revision ?? null;
    if (next !== loaded && row) {
      try { const saved = await saveBudgetSnapshot(next, row.revision); revision = saved.revision; next = saved.state; }
      catch (error) { if (error instanceof BudgetConflict) continue; throw error; }
    }
    return { state: next, revision };
  }
  throw new Error('Бюджет изменяется в другой вкладке. Повторите обновление.');
}
