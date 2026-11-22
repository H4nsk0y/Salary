import test from "node:test";
import assert from "node:assert/strict";

const pages = {
  table: ".timesheet-shell", admin: ".admin-shell", schedule: ".schedule-shell", profile: ".profile-page", settings: ".settings-shell", budget: ".budget-shell",
  "budget-help": ".budget-shell", "budget-archive": ".budget-shell", updates: ".updates-shell", owner: ".owner-shell",
  checklist: ".page-shell", "checklist-history": ".page-shell", "owner-users": ".owner-console-shell", "department-users": ".department-users-shell",
  "owner-analytics": ".owner-console-shell", "owner-ideas": ".ideas-shell", "owner-status": ".status-shell", calculator: ".calculator-shell", help: ".help-shell",
};

test("desktop workspaces use available width without changing mobile geometry", {
  skip: !process.env.PLAYWRIGHT_MODULE || !process.env.BUDGET_BASE_URL,
}, async t => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: "block" });
  const base = process.env.BUDGET_BASE_URL;
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    const js = body => route.fulfill({ contentType: "text/javascript; charset=utf-8", body });
    if (url.origin !== new URL(base).origin) return route.abort();
    if (url.pathname === "/js/auth.js") return js('export async function getSession(){return {user:{id:"layout-test"}}}');
    if (url.pathname === "/js/db.js") return js('export async function getMyProfile(){return {role:"owner",display_name:"Тестовый сотрудник",position:"egais_operator",gender:"male",branch:"chateau_alvisa",employment_date:"2023-01-01",oklad:60000}}');
    if (url.pathname === "/js/errorLogger.js") return js('export function installErrorLogger(){}');
    if (Object.keys(pages).some(name => url.pathname === `/js/${name}.js`) || ['/js/budgetArchive.js','/js/checklistHistory.js','/js/app.js','/js/ideaDialog.js','/js/features/calculatorPrivacy.js'].includes(url.pathname) || url.pathname.includes("tourBootstrap")) return js('');
    return route.continue();
  });
  try {
    for (const [name, shell] of Object.entries(pages)) await t.test(name, async () => {
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date("2026-11-22T12:00:00+03:00"));
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/${name}.html`);
      await page.locator('[data-owner-nav-enhanced="true"]').waitFor();
      await page.evaluate(name => {
        document.querySelector('#alvisaPageLoader')?.remove();
        document.documentElement.classList.remove('alvisa-page-loading');
        document.body.classList.add('is-loaded');
        document.querySelectorAll('.reveal').forEach(element => { element.style.opacity = '1'; element.style.transform = 'none'; element.style.filter = 'none'; element.style.transition = 'none'; });
        if (name === 'table' || name === 'admin') {
          const head = document.querySelector('#headerRow');
          head.innerHTML = '<th class="label-cell">Смена</th>' + Array.from({ length: 31 }, (_, day) => `<th>${day + 1}<span class="th-dow">Пн</span></th>`).join('');
          if (name === 'table') for (const id of ['dayRow','nightRow']) document.querySelector('#' + id).innerHTML = `<td class="label-cell">${id === 'dayRow' ? 'День' : 'Ночь'}</td>` + Array.from({length:31},()=>'<td><input class="input-hour" value="11"></td>').join('');
          else document.querySelector('#matrixBody').innerHTML = Array.from({length:5},(_, index)=>`<tr><td>Сотрудник ${index + 1}</td>${'<td>11</td>'.repeat(31)}</tr>`).join('');
        }
        if (name === 'schedule') document.querySelector('#daysGrid').innerHTML = ['Сегодня','Завтра'].map(day=>`<article class="schedule-day-card glass-card rounded-3xl p-5"><h2 class="schedule-day-title">${day}, понедельник, 23 ноября</h2><div class="schedule-workers mt-5 grid gap-3">${Array.from({length:5},(_, index)=>`<div class="schedule-person flex min-w-0 items-center gap-3 rounded-2xl p-3"><div class="schedule-avatar h-11 w-11 shrink-0">ТС</div><div class="min-w-0"><div class="schedule-person-name">Тестовый сотрудник ${index + 1}</div><span class="schedule-shift-badge">11 ч день</span><div class="schedule-person-meta">Оператор ЕГАИС</div></div></div>`).join('')}</div></article>`).join('');
        if (name === 'profile') document.querySelector('#timesheetsList').innerHTML = ['Январь','Февраль','Март','Апрель','Май','Июнь'].map(month=>`<div class="glass-card p-4"><strong>${month}</strong><p>Переработка: +8 ч</p><a href="table.html">Открыть</a></div>`).join('');
        if (name === 'budget') {
          document.querySelector('#budgetContent').hidden = false;
          for (const id of ['current','free','forecast']) document.querySelector('#'+id).textContent = '25 000 ₽';
          document.querySelector('#next').textContent = '25 ноября';
          document.querySelector('#expenses').innerHTML = '<li><span>Продукты · 500 ₽</span><button>Изменить</button></li>';
          document.querySelector('#bills').innerHTML = '<h3>С 25 ноября по 10 декабря</h3><ul><li><span>Интернет · 1 000 ₽</span><button>Оплачено</button></li></ul>';
          document.querySelector('#incomes').innerHTML = '<li><span>Аванс · 40 000 ₽</span><button>Изменить</button></li>';
        }
        if (name === 'checklist') {
          document.querySelector('#setupView').classList.remove('hidden');
          document.querySelector('#templateGrid').innerHTML = Array.from({length:9},(_, index)=>`<button class="template-button" type="button">Задача смены ${index+1}</button>`).join('');
        }
        if (name === 'checklist-history') {
          document.querySelector('#archive').classList.remove('hidden');
          document.querySelector('#archiveList').innerHTML = '<details class="entry"><summary>22 ноября · выполнено 8 из 8</summary><p>Все задачи выполнены.</p></details>';
        }
      }, name);
      await page.evaluate(() => document.fonts.ready);
      for (const width of [1920, 2560, 1440, 1366, 390]) {
        await page.setViewportSize({ width, height: width < 500 ? 850 : 1080 });
        const geometry = await page.evaluate(shell => {
          const element = document.querySelector(shell);
          const rect = element.getBoundingClientRect();
          const css = getComputedStyle(element);
          const header = document.querySelector('.app-top-header > div:first-child');
          const overflow = document.documentElement.scrollWidth > innerWidth;
          const overflowing = overflow ? [...document.querySelectorAll('body *')].filter(element=>{ const r=element.getBoundingClientRect();return r.width && r.right > innerWidth + 1; }).slice(0,10).map(element=>({tag:element.tagName,id:element.id,class:element.className,width:element.getBoundingClientRect().width,right:element.getBoundingClientRect().right})) : [];
          return { x: rect.x, width: rect.width, padding: parseFloat(css.paddingLeft), headerX: header.getBoundingClientRect().x + parseFloat(getComputedStyle(header).paddingLeft), overflow, overflowing, scrollWidth: document.documentElement.scrollWidth, viewport: innerWidth, tableOverflow: document.querySelector('#tableScrollable') ? getComputedStyle(document.querySelector('#tableScrollable')).overflow : '' };
        }, shell);
        if (width >= 1440 || width < 768) assert.equal(geometry.overflow, false, `${name} overflow at ${width}: ${JSON.stringify(geometry)}`);
        if (width >= 1440) {
          assert.ok(geometry.width >= Math.min(width, name === 'settings' ? 1680 : 1760) - 1);
          assert.ok(Math.abs(geometry.headerX - geometry.x - geometry.padding) <= 1, `${name}: header alignment`);
          if (['table','admin'].includes(name)) assert.ok(Math.abs(geometry.width - width) <= 1);
        }
        if (width === 1920 && name === 'table') {
          assert.ok(await page.locator('#tableScrollable').evaluate(element=>element.scrollWidth <= element.clientWidth + 1), 'all 31 days should fit at 1920');
        }
        if (width === 1920 && name === 'profile') assert.ok((await page.locator('.profile-editor').boundingBox()).width <= 381);
        if (width === 1920 && name === 'schedule') assert.equal(await page.locator('.schedule-workers').first().evaluate(element=>getComputedStyle(element).gridTemplateColumns.split(' ').length), 2);
        if (width === 1920 && name === 'budget') assert.equal(await page.locator('.budget-columns').evaluate(element=>getComputedStyle(element).gridTemplateColumns.split(' ').length), 3);
        if (width === 1920 && name === 'settings') {
          const headers = page.locator('.settings-section-label');
          assert.ok((await headers.nth(3).boundingBox()).x > (await headers.nth(0).boundingBox()).x);
          assert.ok((await headers.nth(4).boundingBox()).y > (await headers.nth(3).boundingBox()).y);
        }
        if (width === 1920 && name === 'budget-help') assert.ok((await page.locator('.guide-content').boundingBox()).width <= 901);
        if (width === 1920 && name === 'updates') assert.ok((await page.locator('.updates-list').boundingBox()).width <= 1121);
        if (width < 1440) {
          await page.evaluate(() => document.querySelector('link[href*="desktop-workspace.css"]').sheet.disabled = true);
          const original = await page.locator(shell).boundingBox();
          await page.evaluate(() => document.querySelector('link[href*="desktop-workspace.css"]').sheet.disabled = false);
          const current = await page.locator(shell).boundingBox();
          for (const key of ['x','y','width','height']) assert.ok(Math.abs(current[key] - original[key]) <= (key === 'height' ? 2 : 0.1), `${name}: narrow ${key} must not change (${original[key]} -> ${current[key]})`);
        }
        if (process.env.WORKSPACE_SCREENSHOT_DIR && [1920,390].includes(width)) await page.screenshot({ path: `${process.env.WORKSPACE_SCREENSHOT_DIR}/workspace-${name}-${width}.png`, fullPage: false });
      }
      assert.deepEqual(errors, []);
      await page.close();
    });
  } finally {
    await context.close();
    await browser.close();
  }
});
