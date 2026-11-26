import { saveDepartmentTimesheetSnapshot, listDepartmentTimesheetSnapshots,
  loadDepartmentTimesheetSnapshot, deleteDepartmentTimesheetSnapshot } from '../db.js';
import { createTimesheetSnapshot } from './timesheetSnapshots.js';

const messageFor = (error) => /department_timesheet_snapshots|PGRST205|42P01/.test(String(error?.message || error?.code))
  ? 'Для снимков нужно выполнить supabase-sql/082_department_timesheet_snapshots.sql в SQL Editor.'
  : /SNAPSHOT_LIMIT_REACHED/.test(error?.message || '') ? 'Уже сохранено 30 вариантов этого месяца. Удалите ненужный снимок.'
  : error?.message || 'Не удалось выполнить действие со снимком.';

export function initAdminTimesheetSnapshots({ getContext, signature, restore }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'timesheet-snapshot-dialog';
  dialog.setAttribute('aria-labelledby', 'snapshotTitle');
  dialog.innerHTML = `<div class="schedule-tools-head"><h2 id="snapshotTitle"></h2><button type="button" class="schedule-tools-button" data-close aria-label="Закрыть">×</button></div>
    <div class="schedule-tools-body"><p data-period></p><form data-save novalidate>
    <label for="snapshotName">Название снимка</label><input id="snapshotName" name="name" maxlength="100" autocomplete="off" placeholder="Например: декабрь — основной вариант">
    <button class="schedule-tools-button schedule-tools-button-primary" type="submit">Сохранить снимок</button></form>
    <div data-list></div><p data-status role="status" aria-live="polite"></p>
    <div data-confirm hidden><p data-question></p><div class="snapshot-confirm-actions"><button type="button" class="schedule-tools-button" data-cancel>Отмена</button><button type="button" class="schedule-tools-button schedule-tools-button-primary" data-accept>Подтвердить</button></div></div></div>`;
  document.body.append(dialog);
  const query = (selector) => dialog.querySelector(selector);
  let active = null, busy = false, confirmAction = null, operation = 0;
  const status = (text) => { query('[data-status]').textContent = text; };
  const valid = (request) => request === operation && dialog.open;
  const setBusy = (value) => {
    busy = value;
    dialog.querySelectorAll('button:not([data-close]),input').forEach((button) => { button.disabled = value; });
  };
  function confirm(text, action) {
    query('[data-question]').textContent = text;
    query('[data-confirm]').hidden = false;
    confirmAction = action;
    query('[data-accept]').focus();
  }
  async function list() {
    const request = operation;
    status('Загружаю снимки…');
    query('[data-list]').replaceChildren();
    const rows = await listDepartmentTimesheetSnapshots(active);
    if (!valid(request)) return;
    status(rows.length ? '' : 'Для этого месяца снимков пока нет.');
    for (const row of rows) {
      const item = document.createElement('div');
      item.className = 'snapshot-list-item';
      const caption = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = row.name;
      const date = document.createElement('small');
      date.textContent = new Date(row.created_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' });
      caption.append(title, date);
      const load = document.createElement('button');
      load.type = 'button'; load.className = 'schedule-tools-button'; load.textContent = 'Загрузить';
      load.addEventListener('click', () => confirm(`Загрузить «${row.name}»? Часы, коды и комментарии сотрудников в этом табеле будут заменены. Новые сотрудники, которых нет в снимке, останутся без изменений.`, async () => {
        const baseline = signature();
        const snapshot = await loadDepartmentTimesheetSnapshot(row.id);
        if (!valid(request)) return;
        if (snapshot.department_key !== active.departmentKey || snapshot.scope !== active.scope || snapshot.year !== active.year || snapshot.month !== active.month) throw new Error('Снимок не относится к открытому табелю.');
        const result = await restore(snapshot.payload, active, baseline);
        if (valid(request)) status(`Снимок загружен. Изменено ячеек: ${result.count}.${result.missing.length ? ` Уже нет в этом табеле: ${result.missing.join(', ')}.` : ''}`);
      }));
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'schedule-tools-button'; remove.textContent = 'Удалить';
      remove.addEventListener('click', () => confirm(`Удалить снимок «${row.name}»? Рабочий табель не изменится.`, async () => {
        await deleteDepartmentTimesheetSnapshot(row.id);
        if (valid(request)) await list();
      }));
      item.append(caption, load, remove);
      query('[data-list]').append(item);
    }
  }
  query('[data-save]').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const context = getContext(active.scope);
    const name = query('#snapshotName').value.trim();
    if (!name) { status('Введите название снимка.'); query('#snapshotName').focus(); return; }
    if (!context || context.year !== active.year || context.month !== active.month) { status('Открытый месяц изменился. Откройте окно заново.'); return; }
    const payload = createTimesheetSnapshot(context.teamStates, active.year, active.month);
    const request = operation;
    setBusy(true);
    try {
      await saveDepartmentTimesheetSnapshot({ ...active, name, payload });
      if (valid(request)) { status('Снимок сохранён. Рабочий табель не изменён.'); query('#snapshotName').value = ''; }
    } catch (error) { if (valid(request)) status(messageFor(error)); }
    finally { setBusy(false); }
  });
  query('[data-accept]').addEventListener('click', async () => {
    if (busy || !confirmAction) return;
    const action = confirmAction;
    const request = operation;
    confirmAction = null;
    query('[data-confirm]').hidden = true;
    setBusy(true);
    try { await action(); } catch (error) { if (valid(request)) status(messageFor(error)); }
    finally { setBusy(false); }
  });
  query('[data-cancel]').addEventListener('click', () => { query('[data-confirm]').hidden = true; confirmAction = null; });
  query('[data-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { operation++; confirmAction = null; });
  document.querySelectorAll('[data-snapshot-action]').forEach((button) => button.addEventListener('click', async () => {
    if (busy) return;
    const scope = button.closest('[data-schedule-scope]')?.dataset.scheduleScope || 'chateau';
    const context = getContext(scope);
    if (!context?.teamStates.length) return;
    operation++;
    active = { departmentKey: context.departmentKey, year: context.year, month: context.month, scope };
    const saving = button.dataset.snapshotAction === 'save';
    query('#snapshotTitle').textContent = saving ? 'Снимок табеля' : 'Загрузить табель';
    query('[data-period]').textContent = `${scope === 'odyssey' ? 'АЛВИСА ОДИССЕЙ' : 'АЛВИСА ШАТО'} · ${new Date(context.year, context.month, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}. Хранение — до конца этого месяца.`;
    query('[data-save]').hidden = !saving;
    query('[data-list]').replaceChildren(); query('[data-confirm]').hidden = true;
    status('');
    dialog.showModal();
    if (saving) query('#snapshotName').focus();
    else {
      setBusy(true);
      try { await list(); } catch (error) { status(messageFor(error)); }
      finally { setBusy(false); }
    }
  }));
}
