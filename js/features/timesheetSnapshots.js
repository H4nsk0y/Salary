import { normalizeLeaveTypeLegacy, DISMISSED_LEAVE_TYPE, NOT_EMPLOYED_LEAVE_TYPE } from './timesheetValues.js';
const LEAVES = new Set(['vac_paid', 'vac_unpaid', 'vac_unpaid_required', 'sick', 'edu_paid', 'edu_unpaid', DISMISSED_LEAVE_TYPE, NOT_EMPLOYED_LEAVE_TYPE]);

export function createTimesheetSnapshot(states, year, month) {
  return { version: 1, year, month, people: states.map((state) => ({
    userId: String(state.userId), name: String(state.name || ''),
    dayHours: [...state.dayHours], nightHours: [...state.nightHours],
    leaveType: [...state.leaveType], shiftComments: [...state.shiftComments],
  })) };
}

export function planSnapshotRestore(snapshot, states, year, month, noNightIds = new Set()) {
  const count = new Date(year, month + 1, 0).getDate();
  if (snapshot?.version !== 1 || snapshot.year !== year || snapshot.month !== month || !Array.isArray(snapshot.people)) {
    throw new Error('Снимок относится к другому месяцу или имеет неподдерживаемый формат.');
  }
  const ids = new Set();
  const missing = [];
  const plans = [];
  for (const person of snapshot.people) {
    if (!person || typeof person.userId !== 'string' || ids.has(person.userId) ||
        !['dayHours', 'nightHours', 'leaveType', 'shiftComments'].every((key) => Array.isArray(person[key]) && person[key].length === count)) {
      throw new Error('Снимок повреждён. Рабочий табель не изменён.');
    }
    ids.add(person.userId);
    const state = states.find((item) => String(item.userId) === person.userId);
    const days = person.dayHours.map((dayHours, index) => {
      const nightHours = person.nightHours[index];
      const rawLeave = person.leaveType[index];
      const leaveType = normalizeLeaveTypeLegacy(rawLeave);
      const comment = person.shiftComments[index];
      if (![dayHours, nightHours].every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 24) ||
          dayHours + nightHours > 24 || (rawLeave != null && rawLeave !== '' && !LEAVES.has(leaveType)) ||
          (leaveType && (dayHours || nightHours)) || typeof comment !== 'string' || comment.length > 300) {
        throw new Error('В снимке есть некорректные часы, коды или комментарии. Рабочий табель не изменён.');
      }
      return { dayHours, nightHours, leaveType, comment };
    });
    if (!state) { missing.push(person.name || person.userId); continue; }
    const changes = [];
    for (const [index, to] of days.entries()) {
      if (state.dismissedBeforeMonth || state.dayInputs?.[index]?.disabled ||
          [DISMISSED_LEAVE_TYPE, NOT_EMPLOYED_LEAVE_TYPE].includes(state.leaveType[index])) continue;
      if (noNightIds.has(String(state.userId)) && to.nightHours > 0) {
        throw new Error(`${state.name}: сейчас установлен запрет ночных смен. Этот снимок нельзя загрузить без исправления.`);
      }
      if ([DISMISSED_LEAVE_TYPE, NOT_EMPLOYED_LEAVE_TYPE].includes(to.leaveType) && to.leaveType !== state.leaveType[index]) {
        throw new Error(`${state.name}: снимок меняет границы трудоустройства. Проверьте их вручную.`);
      }
      if (state.dayHours[index] !== to.dayHours || state.nightHours[index] !== to.nightHours ||
          (state.leaveType[index] || null) !== to.leaveType || state.shiftComments[index] !== to.comment) changes.push({ index, to });
    }
    if (changes.length) plans.push({ state, changes });
  }
  return { plans, missing, count: plans.reduce((sum, plan) => sum + plan.changes.length, 0) };
}
