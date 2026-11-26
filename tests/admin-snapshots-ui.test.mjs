import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('snapshot dialogs and combined schedules work at desktop and mobile sizes without database writes', {
  skip: !process.env.PLAYWRIGHT_MODULE || !process.env.ADMIN_BASE_URL,
}, async () => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const base = process.env.ADMIN_BASE_URL;
  const html = (await readFile(new URL('../admin.html', import.meta.url), 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  const mock = `
    export async function saveDepartmentTimesheetSnapshot(row) { window.fixture.snapshots.push({...structuredClone(row), id:String(window.fixture.snapshots.length + 1), created_at:'2026-11-25T10:00:00Z'}); }
    export async function listDepartmentTimesheetSnapshots(context) { return window.fixture.snapshots.filter(row=>row.scope===context.scope); }
    export async function loadDepartmentTimesheetSnapshot(id) { const row=window.fixture.snapshots.find(row=>row.id===id); return {...row, department_key:row.departmentKey}; }
    export async function deleteDepartmentTimesheetSnapshot(id) { window.fixture.snapshots=window.fixture.snapshots.filter(row=>row.id!==id); }
  `;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) return route.abort();
      if (url.pathname === '/admin.html') return route.fulfill({ contentType: 'text/html', body: html });
      if (url.pathname === '/js/db.js') return route.fulfill({ contentType: 'text/javascript', body: mock });
      return route.continue();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/admin.html');
    await page.evaluate(async () => {
      document.querySelector('#alvisaPageLoader').remove();
      const { initAdminScheduleTools } = await import('/js/features/adminScheduleTools.js');
      const { initAdminTimesheetSnapshots } = await import('/js/features/adminTimesheetSnapshots.js');
      const { planSnapshotRestore } = await import('/js/features/timesheetSnapshots.js');
      const states = Array.from({ length: 4 }, (_, p) => ({ userId: String(p), name: `Тестовый сотрудник ${p + 1}`,
        dayHours: Array(31).fill(0), nightHours: Array(31).fill(0), leaveType: Array(31).fill(null), shiftComments: Array(31).fill(''), dayInputs: [], nightInputs: [] }));
      window.fixture = { snapshots: [], states, restores: 0 };
      const getContext = () => ({ year: 2026, month: 11, departmentKey: 'egais', teamStates: states, personalNorm: () => 176 });
      const signature = () => JSON.stringify(states);
      initAdminScheduleTools({ getContext, signature, loadPreviousMany: async () => new Map(), loadNextMany: async () => new Map(),
        isOwner: true, leaderId: null, applyChanges(plans) { for (const { state, changes } of plans) for (const { index, to } of changes) {
          state.dayHours[index] = to.dayHours; state.nightHours[index] = to.nightHours;
        } } });
      initAdminTimesheetSnapshots({ getContext, signature, restore: async (snapshot) => {
        const result = planSnapshotRestore(snapshot, states, 2026, 11);
        for (const { state, changes } of result.plans) for (const { index, to } of changes) {
          state.dayHours[index] = to.dayHours; state.nightHours[index] = to.nightHours;
          state.leaveType[index] = to.leaveType; state.shiftComments[index] = to.comment;
        }
        window.fixture.restores++;
        return result;
      } });
    });
    await page.locator('[data-schedule-scope="chateau"] [data-schedule-tool="odysseyChateau3"]').click();
    await page.locator('#scheduleToolsCyclePick').click();
    await page.locator('.plant-cycle-calendar').waitFor({ state: 'visible' });
    await page.locator('.plant-cycle-calendar [data-calendar-close]').click();
    await page.locator('#scheduleToolsPreview').click();
    await page.waitForFunction(() => !document.querySelector('#scheduleToolsApply').disabled);
    assert.match(await page.locator('#scheduleToolsSummary').innerText(), /Покрытие рассчитано/);
    await page.locator('#scheduleToolsCycleStart').fill('не дата');
    await page.locator('#scheduleToolsCycleStart').dispatchEvent('change');
    assert.equal(await page.locator('#scheduleToolsApply').isDisabled(), true);
    await page.locator('#scheduleToolsPreview').click();
    assert.match(await page.locator('#scheduleToolsSummary').innerText(), /дату/);
    await page.locator('#scheduleToolsCycleStart').fill('01.12.2026');
    await page.locator('#scheduleToolsPreview').click();
    await page.waitForFunction(() => !document.querySelector('#scheduleToolsApply').disabled);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width < 500 ? 850 : 1000 });
      const bounds = await page.locator('.schedule-tools-dialog').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1);
      if (process.env.ADMIN_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.ADMIN_SCREENSHOT_DIR, `admin-combined-${width}.png`) });
    }
    await page.locator('#scheduleToolsApply').click();
    const expected = await page.evaluate(() => structuredClone(window.fixture.states));
    assert.ok(expected.some(state => state.nightHours.some(hours => hours > 0)));
    await page.locator('[data-schedule-scope="chateau"] [data-snapshot-action="save"]').click();
    await page.locator('#snapshotName').fill('Декабрь — основной <img onerror=alert(1)>');
    await page.locator('.timesheet-snapshot-dialog button[type="submit"]').click();
    await page.waitForFunction(() => window.fixture.snapshots.length === 1);
    assert.equal(await page.evaluate(() => window.fixture.restores), 0);
    await page.locator('.timesheet-snapshot-dialog [data-close]').click();
    await page.evaluate(() => { for (const state of window.fixture.states) { state.dayHours.fill(0); state.nightHours.fill(0); } });
    await page.locator('[data-schedule-scope="chateau"] [data-snapshot-action="load"]').click();
    await page.locator('.snapshot-list-item').waitFor();
    assert.equal(await page.locator('.snapshot-list-item img').count(), 0);
    await page.locator('.snapshot-list-item').getByRole('button', { name: 'Загрузить', exact: true }).click();
    await page.locator('[data-cancel]').click();
    assert.equal(await page.evaluate(() => window.fixture.restores), 0);
    await page.locator('.snapshot-list-item').getByRole('button', { name: 'Загрузить', exact: true }).click();
    await page.locator('[data-accept]').click();
    await page.waitForFunction(() => window.fixture.restores === 1);
    assert.deepEqual(await page.evaluate(() => window.fixture.states), expected);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width < 500 ? 850 : 1000 });
      const box = await page.locator('.timesheet-snapshot-dialog').boundingBox();
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1);
      assert.equal(await page.locator('.timesheet-snapshot-dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
      if (process.env.ADMIN_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.ADMIN_SCREENSHOT_DIR, `admin-snapshots-${width}.png`) });
    }
    await page.locator('.snapshot-list-item').getByRole('button', { name: 'Удалить', exact: true }).click();
    await page.locator('[data-accept]').click();
    await page.waitForFunction(() => window.fixture.snapshots.length === 0);
    await page.locator('.timesheet-snapshot-dialog [data-close]').click();
    await page.evaluate(() => { for (const state of window.fixture.states) { state.dayHours.fill(0); state.nightHours.fill(0); } });
    await page.locator('[data-schedule-scope="chateau"] [data-schedule-tool="odysseyChateau4"]').click();
    await page.locator('#scheduleToolsPreview').click();
    await page.waitForFunction(() => !document.querySelector('#scheduleToolsApply').disabled);
    assert.match(await page.locator('#scheduleToolsTitle').innerText(), /4 суток/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
