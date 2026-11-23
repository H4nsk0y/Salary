import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const mockClient = `
const f = window.__budgetFixture;
class Query {
  constructor(table) { this.table=table; this.filters={}; this.operation='select'; }
  select(){return this;} eq(k,v){this.filters[k]=v;return this;}
  or(){return this;} order(){return this;} limit(){return this;}
  insert(v){this.operation='insert';this.value=v;return this;}
  update(v){this.operation='update';this.value=v;return this;}
  upsert(){return this;}
  maybeSingle(){return this.run();} single(){return this.run();}
  then(a,b){return this.run().then(a,b);}
  async run(){
    if(this.table==='finance_budgets') {
      f.reads++;
      if(f.fail) return {data:null,error:new Error('Тест: сеть недоступна')};
      if(this.operation==='update') {
        if(this.filters.revision!==f.revision) return {data:null,error:null};
        f.state=this.value.state;f.revision=this.value.revision;f.writes++;
      } else if(this.operation==='insert') {
        if(f.state) return {data:null,error:{code:'23505'}};
        f.state=this.value.state;f.revision=0;f.writes++;
      }
      return {data:f.state?{state:structuredClone(f.state),revision:f.revision}:null,error:null};
    }
    if(this.table==='timesheets') return {data:f.timesheets,error:null};
    if(this.table==='profiles') return {data:f.profile,error:null};
    return {data:[],error:null};
  }
}
const channel={on(){return this},subscribe(){return this},unsubscribe(){}};
export const supabase={
  auth:{getSession:async()=>({data:{session:f.anonymous?null:{user:{id:'fixture-owner'}}},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
  from:table=>new Query(table),
  rpc:async(name)=>({data:name==='get_my_app_context'?{profile:f.profile}:[],error:null}),
  channel:()=>channel,removeChannel(){},functions:{invoke:async()=>({data:{},error:null})}
};`;

const fixture = () => ({
  profile: { user_id: "fixture-owner", role: "owner", weekly_hours: 40, branch: "chateau_alvisa", employment_date: "2023-01-01", display_name: "Владелец", position: "Оператор ЕГАИС", tab_number: "001", oklad: 60000 },
  state: { daily: 50000, salaryAutoStart: '2026-11-21', records: [
    { id: "balance", type: "balance", title: "Баланс", date: "2026-11-20", amount: 10000000, stamp: 1, closed: true },
    { id: "expense", type: "expense", title: "Продукты", date: "2026-11-21", amount: 50000, category: "Лень считать", stamp: 2 },
    { id: "bill", type: "bill", title: "Интернет", date: "2026-11-25", amount: 200000, remind: 5, stamp: 3 },
  ] }, revision: 7, reads: 0, writes: 0,
  timesheets: [{ year: 2026, month: 10, payload: { paySummary: { actual: { advance: 12345, confirmedAt: "2026-11-20" }, calculated: { advance: 12000 } } } }],
});

test("budget desktop/mobile, cloud compatibility, mutations, conflict and access guards", { skip: !process.env.PLAYWRIGHT_MODULE || !process.env.BUDGET_BASE_URL }, async t => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const base = process.env.BUDGET_BASE_URL;
  const contexts = [];
  async function open(data = fixture(), width = 1440, path = '/budget.html', date = '2026-11-21T12:00:00Z') {
    const context = await browser.newContext({ viewport: { width, height: width < 500 ? 850 : 1000 }, serviceWorkers: "block" });
    contexts.push(context);
    await context.addInitScript((data) => {
      window.__budgetFixture = data;
      localStorage.setItem("hanskoy-finance", JSON.stringify({ daily: 999, records: [] }));
    }, data);
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) { await route.abort(); return; }
      if (url.pathname === "/js/supabaseClient.js") { await route.fulfill({ contentType: "text/javascript", body: mockClient }); return; }
      if (["/profile.html", "/login.html"].includes(url.pathname)) {
        await route.fulfill({ contentType: "text/html", body: '<div data-app-header></div><script type="module" src="./js/nav.js"></script>' }); return;
      }
      await route.continue();
    });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(date));
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base + path);
    return { page, errors };
  }
  const loaded = async page => {
    await page.locator("#budgetContent").waitFor({ state: "visible" });
    await page.waitForFunction(() => !document.querySelector("#calendar")?.textContent.includes("Обновляем"));
    await page.waitForFunction(() => !document.documentElement.classList.contains("alvisa-page-loading"));
  };
  const number = text => text.replace(/[^\d,-]/g, "");
  try {
    await t.test("two-line daily summary freezes the first-purchase limit and survives refresh", async () => {
      const data = fixture();
      data.state.records = [{ id: 'balance', type: 'balance', date: '2026-11-21', amount: 300000, stamp: 1 }];
      const { page, errors } = await open(data, 1440, '/budget.html', '2026-11-22T12:00:00Z');
      await loaded(page);
      assert.equal(number(await page.locator('#expenseTodayTotal').innerText()), '0');
      assert.equal(number(await page.locator('#expenseTodayRemaining').innerText()), '1000');
      assert.equal(await page.locator('#expenseTodaySummary > div').count(), 2);
      assert.equal(await page.locator('#paymentCountdown').innerText(), '(2 д 22:00:00)');
      await page.clock.setFixedTime(new Date('2026-11-22T12:00:01Z'));
      await page.waitForFunction(() => document.querySelector('#paymentCountdown').textContent === '(2 д 21:59:59)');
      assert.equal(await page.evaluate(() => window.__budgetFixture.writes), 0);
      for (const amount of ['150','300','136','30','146']) {
        await page.locator('#expense').click();
        await page.locator('[name="amount"]').fill(amount);
        await page.locator('#submit').click();
        await page.locator('#dialog').waitFor({ state: 'hidden' });
      }
      assert.equal(number(await page.locator('#expenseTodayTotal').innerText()), '762');
      assert.equal(await page.locator('#expenseTodayRemainingLabel').innerText(), 'Можно потратить ещё');
      assert.equal(number(await page.locator('#expenseTodayRemaining').innerText()), '238');
      const anchor = await page.evaluate(() => window.__budgetFixture.state.dailySpendingAnchor);
      assert.equal(anchor.total, 100000);
      assert.equal(anchor.estimated, false);
      await page.locator('#refresh').click();
      await loaded(page);
      assert.equal(number(await page.locator('#expenseTodayRemaining').innerText()), '238');
      await page.locator('#alvisaPageLoader').waitFor({ state: 'hidden' });
      for (const width of [1920, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.locator('#expenseTodaySummary').scrollIntoViewIfNeeded();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (process.env.BUDGET_SCREENSHOT_DIR) await page.screenshot({ path: process.env.BUDGET_SCREENSHOT_DIR + '/budget-daily-' + width + '.png' });
      }
      await page.locator('#expense').click();
      await page.locator('[name="amount"]').fill('300');
      await page.locator('#submit').click();
      await page.locator('#dialog').waitFor({ state: 'hidden' });
      assert.equal(number(await page.locator('#expenseTodayTotal').innerText()), '1062');
      assert.equal(await page.locator('#expenseTodayRemainingLabel').innerText(), 'Лимит превышен на');
      assert.equal(number(await page.locator('#expenseTodayRemaining').innerText()), '62');
      assert.deepEqual(errors, []);
      await page.close();
    });
    await t.test("owner sees old cloud data and mobile action without horizontal overflow", async () => {
      const { page, errors } = await open();
      await loaded(page);
      assert.equal(number(await page.locator("#current").innerText()), "99500");
      assert.equal(number(await page.locator("#free").innerText()), "99500");
      assert.match(await page.locator("#nextAmount").innerText(), /12.?345/);
      assert.equal(await page.locator('[data-nav-slot="desktop"] a[href="budget.html"]').count(), 1);
      assert.equal(await page.evaluate(() => window.__budgetFixture.writes), 0);
      for (const width of [1440, 440, 320]) {
        await page.setViewportSize({ width, height: width < 500 ? 850 : 1000 });
        const geometry = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, button: document.querySelector("#balance").getBoundingClientRect().toJSON() }));
        assert.ok(geometry.width <= geometry.viewport, JSON.stringify(geometry));
        assert.ok(geometry.button.bottom < 850 && geometry.button.x >= 0, JSON.stringify(geometry));
        if (process.env.BUDGET_SCREENSHOT_DIR) await page.screenshot({ path: process.env.BUDGET_SCREENSHOT_DIR + "/budget-" + width + ".png", fullPage: true });
      }
      assert.deepEqual(errors, []);
      await page.close();
    });
    await t.test("actual payment, live slider, checkpoint edit and household persist by revision", async () => {
      const { page } = await open(fixture(), 440);
      await loaded(page);
      await page.locator("#daily").fill("1000");
      await page.locator("#daily").dispatchEvent("input");
      assert.equal(number(await page.locator("#forecast").innerText()), "91500");
      await page.locator("#bills li").getByRole("button", { name: "Оплачено", exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#current').textContent.replace(/\D/g, '') === '97500');
      assert.equal(await page.locator('#bills-paid li').count(), 1);
      await page.locator('#bills-paid li').getByRole('button', { name: 'Изменить', exact: true }).click();
      await page.locator('[name="amount"]').fill("1800");
      const modal = await page.locator("#dialog").boundingBox();
      assert.ok(modal.y >= 0 && modal.y + modal.height <= 850);
      await page.locator("#submit").click();
      await page.locator("#dialog").waitFor({ state: "hidden" });
      assert.equal(number(await page.locator("#current").innerText()), "97700");
      assert.equal(number(await page.locator("#free").innerText()), "97700");
      await page.locator("#incomes li").filter({ hasText: "Аванс" }).first().getByRole("button", { name: "Получено", exact: true }).click();
      await page.locator("#submit").click();
      await page.locator("#dialog").waitFor({ state: "hidden" });
      assert.equal(number(await page.locator("#current").innerText()), "110045");
      await page.locator("#household").click();
      await page.locator('[name="people"]').fill("4");
      await page.locator("#submit").click();
      await page.locator("#dialog").waitFor({ state: "hidden" });
      assert.equal(await page.locator("#freeLabel").innerText(), "Свободно на 4 человек");
      await page.locator("#balance").click();
      await page.locator('[name="amount"]').fill("90000");
      assert.equal(await page.locator('[name="mode"] option[value="close"]').isDisabled(), true);
      await page.locator("#submit").click();
      await page.locator("#dialog").waitFor({ state: "hidden" });
      assert.equal(number(await page.locator("#current").innerText()), "90000");
      await page.locator(".budget-history summary").click();
      await page.locator("#balances li").first().getByRole("button", { name: "Изменить" }).click();
      await page.locator('[name="amount"]').fill("91000");
      await page.locator("#submit").click();
      await page.locator("#dialog").waitFor({ state: "hidden" });
      assert.equal(number(await page.locator("#current").innerText()), "91000");
      await page.locator("#refresh").click();
      await loaded(page);
      assert.equal(number(await page.locator("#current").innerText()), "91000");
      assert.equal(await page.evaluate(() => window.__budgetFixture.state.records.filter(r => r.nominal === "2026-11-25").length), 1);
      await page.close();
    });
    await t.test("conflicting write reloads current cloud state and does not overwrite it", async () => {
      const { page } = await open();
      await loaded(page);
      await page.locator("#expense").click();
      await page.locator('[name="amount"]').fill("1000");
      await page.evaluate(() => { window.__budgetFixture.revision++; window.__budgetFixture.state.records[0].amount = 20000000; });
      await page.locator("#submit").click();
      await page.waitForFunction(() => document.querySelector("#error").textContent.includes("другой вкладке"));
      assert.equal(await page.evaluate(() => window.__budgetFixture.writes), 0);
      assert.equal(number(await page.locator("#current").innerText()), "199500");
      await page.close();
    });
    await t.test("first checkpoint creates an empty cloud budget without importing local Finance", async () => {
      const { page } = await open({ ...fixture(), state: null, revision: null }, 320);
      await loaded(page);
      assert.equal(await page.locator("#current").innerText(), "—");
      await page.locator("#balance").click();
      await page.locator('[name="amount"]').fill("15000.25");
      await page.locator("#submit").click();
      await page.locator("#dialog").waitFor({ state: "hidden" });
      assert.equal(number(await page.locator("#current").innerText()), "15000,25");
      const saved = await page.evaluate(() => ({ state: window.__budgetFixture.state, revision: window.__budgetFixture.revision }));
      assert.equal(saved.revision, 0);
      assert.equal(saved.state.people, 2);
      assert.equal(saved.state.daily, 0);
      assert.equal(saved.state.records.length, 1);
      await page.close();
    });
    await t.test("manual payday amount and date remain after refresh", async () => {
      const { page } = await open();
      await loaded(page);
      await page.locator("#incomes li").filter({ hasText: "Аванс" }).first().getByRole("button", { name: "Изменить", exact: true }).click();
      await page.locator('[name="amount"]').fill("13500");
      await page.locator('[name="date"]').fill("2026-11-24");
      await page.locator("#submit").click();
      await page.locator("#dialog").waitFor({ state: "hidden" });
      await page.locator("#refresh").click();
      await loaded(page);
      assert.equal(await page.locator("#next").innerText(), "24 ноября");
      assert.equal(number(await page.locator("#nextAmount").innerText()), "13500");
      assert.equal(await page.locator("#paymentSource").innerText(), "Исправлено вручную");
      await page.close();
    });
    await t.test("failed load never writes an empty replacement budget", async () => {
      const { page } = await open({ ...fixture(), fail: true });
      await page.waitForFunction(() => document.querySelector("#status").textContent.includes("Не удалось"));
      assert.equal(await page.locator("#budgetContent").isHidden(), true);
      assert.equal(await page.evaluate(() => window.__budgetFixture.writes), 0);
      await page.close();
    });
    await t.test("forms use themed validation and calendar with future dates only where allowed", async () => {
      const { page } = await open(fixture(), 320);
      await loaded(page);
      assert.equal(await page.locator('#otherPayments').count(), 0);
      await page.locator('#bill').click();
      await page.locator('#submit').click();
      assert.match(await page.locator('#error').innerText(), /Заполните поле «Название»/);
      assert.equal(await page.locator('[name="title"]').getAttribute('aria-invalid'), 'true');
      assert.equal(await page.locator('#editor').evaluate(form => form.noValidate), true);
      if (process.env.BUDGET_SCREENSHOT_DIR) await page.screenshot({ path: process.env.BUDGET_SCREENSHOT_DIR + '/budget-form.png' });
      await page.locator('[name="title"]').fill('Проверка календаря');
      await page.locator('[name="amount"]').fill('100');
      await page.locator('.budget-date-field button').click();
      await page.locator('.budget-date-calendar').waitFor({ state: 'visible' });
      const box = await page.locator('.budget-date-calendar').boundingBox();
      assert.ok(box.y >= 0 && box.x >= 0 && box.x + box.width <= 320);
      await page.locator('[data-calendar-next]').click();
      await page.locator('[data-calendar-days] [data-day="25"]').click();
      assert.equal(await page.locator('[name="date"]').inputValue(), '25.12.2026');
      await page.locator('#submit').click();
      await page.locator('#dialog').waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => window.__budgetFixture.state.records.find(r => r.title === 'Проверка календаря').date), '2026-12-25');
      await page.locator('#expense').click();
      await page.locator('.budget-date-field button').click();
      assert.equal(await page.locator('[data-calendar-next]').isDisabled(), true);
      assert.equal(await page.locator('[data-calendar-days] [data-day="22"]').isDisabled(), true);
      if (process.env.BUDGET_SCREENSHOT_DIR) await page.screenshot({ path: process.env.BUDGET_SCREENSHOT_DIR + '/budget-calendar.png' });
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#dialog').isVisible(), true);
      await page.close();
    });
    await t.test("month rollover selects the new month without deleting past expenses", async () => {
      const { page } = await open(fixture(), 440, '/budget-archive.html');
      await loaded(page);
      assert.equal(number(await page.locator('#monthTotal').innerText()), '500');
      await page.clock.setFixedTime(new Date('2026-12-01T12:00:00Z'));
      await page.locator('#refresh').click();
      await page.waitForFunction(() => document.querySelector('#expenseMonth').value === '11');
      assert.equal(number(await page.locator('#monthTotal').innerText()), '0');
      await page.locator('#expenseMonth').selectOption('10');
      assert.equal(number(await page.locator('#monthTotal').innerText()), '500');
      assert.equal(await page.evaluate(() => window.__budgetFixture.state.records.filter(r => r.type === 'expense').length), 1);
      await page.close();
    });
    await t.test("department-edited hours produce numeric advance and remainder and fund the payday bill", async () => {
      const data = fixture();
      data.state.daily = 0;
      data.state.records[0] = { ...data.state.records[0], date: '2026-11-21', amount: 474400, closed: false };
      data.state.records[1].stamp = 0;
      data.state.records[2].amount = 1000000;
      data.timesheets = [{ year: 2026, month: 10, payload: {
        dayHours: Array.from({ length: 30 }, (_, i) => [0, 6].includes(new Date(2026, 10, i + 1).getDay()) ? 0 : 8),
        nightHours: Array(30).fill(0),
      } }];
      const { page } = await open(data);
      await loaded(page);
      assert.equal(number(await page.locator('#current').innerText()), '4744');
      assert.equal(number(await page.locator('#free').innerText()), '4744');
      // November's calendar includes the shortened day on November 3: norm 159h.
      assert.equal(number(await page.locator('#forecast').innerText()), '0');
      const incomeRows = await page.locator('#incomes li strong').allTextContents();
      assert.equal(number(incomeRows[0]), '26264,15');
      assert.equal(number(incomeRows[1]), '51740,38');
      assert.equal(await page.evaluate(() => window.__budgetFixture.writes), 0);
      await page.close();
    });
    await t.test("ordinary users and guests cannot load budget or see its navigation", async () => {
      for (const anonymous of [false, true]) {
        const data = fixture(); data.anonymous = anonymous; data.profile.role = "user";
        const { page } = await open(data);
        await page.waitForURL(anonymous ? "**/login.html?next=budget.html" : "**/profile.html");
        assert.equal(await page.evaluate(() => window.__budgetFixture.reads), 0);
        assert.equal(await page.locator('a[href="budget.html"]').count(), 0);
        await page.close();
      }
    });
    await t.test("payment periods, totals, strike-through and Return debit and restore exactly once", async () => {
      const data = fixture();
      data.state.records.push({ id: 'bill2', type: 'bill', title: 'Связь', date: '2026-11-23', amount: 100000, stamp: 4 });
      data.state.records.push({ id: 'prior', type: 'income', title: 'Остаток зарплаты', nominal: '2026-11-10', date: '2026-11-10', settled: '2026-11-10', amount: 1619988 });
      data.timesheets[0].payload.paySummary.calculated.remaining = 20000;
      const { page } = await open(data, 320);
      await loaded(page);
      assert.match(await page.locator('#bills').innerText(), /С 25 ноября по 10 декабря/);
      assert.match(await page.locator('#bills').innerText(), /С 10 ноября по 25 ноября/);
      assert.equal(number(await page.locator('#billOutstanding').innerText()), '3000');
      assert.equal(number(await page.locator('#incomeTotal').innerText()), '32345');
      assert.equal(await page.locator('#incomes li').count(), 2);
      assert.match(await page.locator('#incomePeriod').innerText(), /С 10 ноября по 10 декабря/);
      await page.locator('#bills li').filter({ hasText: 'Интернет' }).getByRole('button', { name: 'Оплачено', exact: true }).click();
      await page.locator('#bills-paid li').waitFor();
      assert.equal(number(await page.locator('#current').innerText()), '97500');
      assert.equal(number(await page.locator('#billOutstanding').innerText()), '1000');
      assert.match(await page.locator('#bills-paid strong').evaluate(node => getComputedStyle(node).textDecorationLine), /line-through/);
      assert.equal(await page.locator('#bills > ul').last().getAttribute('id'), 'bills-paid');
      if (process.env.BUDGET_SCREENSHOT_DIR) await page.screenshot({ path: process.env.BUDGET_SCREENSHOT_DIR + '/budget-paid-320.png', fullPage: true });
      await page.locator('#bills-paid li').getByRole('button', { name: 'Вернуть', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('#bills-paid'));
      assert.equal(number(await page.locator('#current').innerText()), '99500');
      assert.equal(number(await page.locator('#billOutstanding').innerText()), '3000');
      await page.close();
    });
    await t.test("per-person slider and recorded expense use real available funds only", async () => {
      const data = fixture();
      data.state.daily = 0;
      data.state.records = [{ id: 'balance', type: 'balance', title: 'Баланс', date: '2026-11-21', amount: 474400, stamp: 1 }];
      const { page } = await open(data, 440);
      await loaded(page);
      assert.match(await page.locator('#dailyHint').innerText(), /593/);
      await page.locator('#daily').fill('593');
      await page.locator('#daily').dispatchEvent('input');
      assert.equal(number(await page.locator('#forecast').innerText()), '0');
      assert.equal(await page.locator('#cashGap').isHidden(), true);
      await page.locator('#expense').click();
      await page.locator('[name="amount"]').fill('744');
      await page.locator('#submit').click();
      await page.locator('#dialog').waitFor({ state: 'hidden' });
      assert.equal(number(await page.locator('#current').innerText()), '4000');
      assert.match(await page.locator('#dailyHint').innerText(), /500/);
      assert.match(await page.locator('#expenses').innerText(), /744/);
      await page.locator('#refresh').click();
      await loaded(page);
      assert.equal(number(await page.locator('#current').innerText()), '4000');
      await page.close();
    });
    await t.test("future bill adds the next advance without changing current-cycle income or spending", async () => {
      const data = fixture();
      data.timesheets[0].payload.paySummary.calculated.remaining = 20000;
      data.timesheets.push({ year: 2026, month: 11, payload: { paySummary: { calculated: { advance: 15000 } } } });
      const { page } = await open(data, 440);
      await loaded(page);
      assert.equal(await page.locator('#extraIncome').isHidden(), true);
      const forecast = await page.locator('#forecast').innerText();
      await page.locator('#bill').click();
      await page.locator('[name="title"]').fill('Декабрь');
      await page.locator('[name="amount"]').fill('10000');
      await page.locator('[name="date"]').fill('2026-12-25');
      await page.locator('#submit').click();
      await page.locator('#dialog').waitFor({ state: 'hidden' });
      assert.equal(await page.locator('#extraIncome').isVisible(), true);
      assert.match(await page.locator('#nextIncome').innerText(), /25 декабря/);
      assert.match(await page.locator('#nextIncome').innerText(), /15.?000/);
      assert.equal(number(await page.locator('#incomeTotal').innerText()), '32345');
      assert.equal(await page.locator('#forecast').innerText(), forecast);
      await page.locator('#bills li').filter({ hasText: 'Декабрь' }).getByRole('button', { name: 'Оплачено', exact: true }).click();
      await page.locator('#extraIncome').waitFor({ state: 'hidden' });
      await page.locator('#bills-paid li').filter({ hasText: 'Декабрь' }).getByRole('button', { name: 'Вернуть', exact: true }).click();
      await page.locator('#extraIncome').waitFor({ state: 'visible' });
      await page.close();
    });
    await t.test("Moscow 10:00 auto receipt can be corrected and never duplicates on refresh", async () => {
      const { page } = await open();
      await loaded(page);
      await page.clock.setFixedTime(new Date('2026-11-25T06:59:00Z'));
      await page.locator('#refresh').click();
      await loaded(page);
      assert.equal(number(await page.locator('#current').innerText()), '99500');
      await page.clock.setFixedTime(new Date('2026-11-25T07:00:00Z'));
      await page.locator('#refresh').click();
      await loaded(page);
      assert.equal(number(await page.locator('#current').innerText()), '111845');
      await page.locator('#incomes li').filter({ hasText: 'Аванс' }).getByRole('button', { name: 'Изменить', exact: true }).click();
      await page.locator('[name="amount"]').fill('15000');
      await page.locator('#submit').click();
      await page.locator('#dialog').waitFor({ state: 'hidden' });
      await page.locator('#refresh').click();
      await loaded(page);
      assert.equal(number(await page.locator('#current').innerText()), '114500');
      assert.equal(await page.evaluate(() => window.__budgetFixture.state.records.filter(row => row.nominal === '2026-11-25').length), 1);
      await page.close();
    });
    await t.test("existing money PIN protects budget before cloud fetch", async () => {
      const data = fixture();
      Object.assign(data.profile, { hide_money: true, money_pin_salt: "fixture-salt", money_pin_hash: createHash("sha256").update("fixture-salt:1234").digest("hex") });
      const { page } = await open(data);
      await page.locator("#unlock").waitFor({ state: "visible" });
      assert.equal(await page.evaluate(() => window.__budgetFixture.reads), 0);
      await page.locator("#unlock").click();
      await page.locator("#moneyPinInput").fill("1234");
      await page.locator("#moneyPinInput").press("Enter");
      await loaded(page);
      assert.equal(number(await page.locator("#current").innerText()), "99500");
      await page.close();
    });
    await t.test("today closing checkpoint is persisted as live and expense/payment debits survive next day", async () => {
      const data = fixture();
      data.state.records = [
        { id: 'balance', type: 'balance', title: 'Баланс', date: '2026-11-21', amount: 474400, closed: true, stamp: 1 },
        { id: 'covered', type: 'expense', title: 'Уже учтено', date: '2026-11-21', amount: 100000, stamp: 0 },
        { id: 'later', type: 'expense', title: 'После сверки', date: '2026-11-21', amount: 50000, stamp: 2 },
        { id: 'bill', type: 'bill', title: 'Платёж', date: '2026-11-25', amount: 200000, stamp: 3 },
      ];
      const { page } = await open(data, 440);
      await loaded(page);
      assert.equal(number(await page.locator('#current').innerText()), '4244');
      assert.equal(await page.evaluate(() => window.__budgetFixture.state.records[0].closed), false);
      await page.locator('#expense').click();
      await page.locator('[name="amount"]').fill('100');
      await page.locator('#submit').click();
      await page.locator('#dialog').waitFor({ state: 'hidden' });
      assert.equal(number(await page.locator('#current').innerText()), '4144');
      await page.locator('#bills li').getByRole('button', { name: 'Оплачено', exact: true }).click();
      await page.locator('#bills-paid').waitFor();
      assert.equal(number(await page.locator('#current').innerText()), '2144');
      await page.locator('#bills-paid').getByRole('button', { name: 'Вернуть', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('#bills-paid'));
      await page.clock.setFixedTime(new Date('2026-11-22T12:00:00Z'));
      await page.locator('#refresh').click();
      await loaded(page);
      assert.equal(number(await page.locator('#current').innerText()), '4144');
      assert.equal(await page.locator('#expenses li').count(), 1);
      await page.locator('#expenses li').getByRole('button', { name: 'В архив', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('#expenses li'));
      assert.equal(number(await page.locator('#current').innerText()), '4144');
      assert.equal(await page.evaluate(() => window.__budgetFixture.state.records.filter(row => row.type === 'expense').every(row => row.archived)), true);
      await page.close();
    });
    await t.test("archive contains categories, can restore and edit expenses, and remains owner-only", async () => {
      const data = fixture();
      data.state.records[1] = { ...data.state.records[1], date: '2026-11-20', category: 'Продукты', archived: true };
      const { page, errors } = await open(data, 440, '/budget-archive.html');
      await loaded(page);
      assert.match(await page.locator('#stats').innerText(), /Продукты/);
      assert.equal(number(await page.locator('#monthTotal').innerText()), '500');
      await page.locator('#archiveRows summary').click();
      await page.locator('#archiveRows').getByRole('button', { name: 'Изменить', exact: true }).click();
      await page.locator('#archiveAmount').fill('600');
      await page.locator('#submit').click();
      await page.locator('#dialog').waitFor({ state: 'hidden' });
      assert.equal(number(await page.locator('#monthTotal').innerText()), '600');
      await page.locator('#archiveRows summary').click();
      await page.locator('#archiveRows').getByRole('button', { name: 'Вернуть на главную', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('#archiveRows details'));
      assert.equal(await page.evaluate(() => window.__budgetFixture.state.records[1].archived), false);
      for (const width of [320, 440, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (process.env.BUDGET_SCREENSHOT_DIR) await page.screenshot({ path: process.env.BUDGET_SCREENSHOT_DIR + '/budget-archive-' + width + '.png', fullPage: true });
      }
      assert.deepEqual(errors, []);
      await page.close();
      const ordinary = fixture(); ordinary.profile.role = 'user';
      const denied = await open(ordinary, 440, '/budget-archive.html');
      await denied.page.waitForURL('**/profile.html');
      assert.equal(await denied.page.evaluate(() => window.__budgetFixture.reads), 0);
      await denied.page.close();
    });
    await t.test("slider starts at maximum and recalculates for reserve mode, expenses, and date", async () => {
      const data = fixture();
      data.state.records[2].date = '2026-11-24';
      const { page } = await open(data, 440);
      await loaded(page);
      assert.equal(Number(await page.locator('#daily').inputValue()), 12437.5);
      assert.equal(number(await page.locator('#forecast').innerText()), '0');
      await page.locator('#reserveBills').check();
      await page.waitForFunction(() => window.__budgetFixture.state.reserveBills === true);
      assert.equal(number(await page.locator('#current').innerText()), '99500');
      assert.equal(number(await page.locator('#free').innerText()), '97500');
      assert.equal(Number(await page.locator('#daily').inputValue()), 12187.5);
      await page.clock.setFixedTime(new Date('2026-11-22T12:00:00Z'));
      await page.locator('#refresh').click();
      await loaded(page);
      assert.equal(Number(await page.locator('#daily').inputValue()), 16250);
      await page.locator('#expense').click();
      await page.locator('[name="amount"]').fill('500');
      await page.locator('#submit').click();
      await page.locator('#dialog').waitFor({ state: 'hidden' });
      assert.equal(number(await page.locator('#current').innerText()), '99000');
      assert.equal(number(await page.locator('#free').innerText()), '97000');
      assert.ok(Math.abs(Number(await page.locator('#daily').inputValue()) - 97000 / 3 / 2) < .00001);
      assert.equal(number(await page.locator('#forecast').innerText()), '0');
      await page.locator('#bills li').getByRole('button', { name: 'Оплачено', exact: true }).click();
      await page.locator('#bills-paid').waitFor();
      assert.equal(number(await page.locator('#current').innerText()), '97000');
      assert.equal(number(await page.locator('#free').innerText()), '97000');
      assert.equal(number(await page.locator('#forecast').innerText()), '0');
      await page.close();
    });
    await t.test("deadline colors and reserve setting persist across fresh sessions", async () => {
      const data = fixture();
      for (const [name, date] of [['Зелёный', '2026-11-24'], ['Жёлтый', '2026-11-23'], ['Красный', '2026-11-21']]) {
        data.state.records.push({ id: name, type: 'bill', title: name, date, amount: 10000, remind: 5 });
      }
      const { page } = await open(data, 440);
      await loaded(page);
      for (const [name, color] of [['Зелёный', 'green'], ['Жёлтый', 'yellow'], ['Красный', 'red']]) {
        assert.match(await page.locator('#bills li').filter({ hasText: name }).getAttribute('class'), new RegExp('urgency-' + color));
        assert.match(await page.locator('#reminders > div').filter({ hasText: name }).getAttribute('class'), new RegExp('urgency-' + color));
      }
      await page.locator('#reserveBills').check();
      await page.waitForFunction(() => window.__budgetFixture.state.reserveBills === true);
      const saved = await page.evaluate(() => window.__budgetFixture);
      await page.close();
      const reopened = await open(saved, 440);
      await loaded(reopened.page);
      assert.equal(await reopened.page.locator('#reserveBills').isChecked(), true);
      await reopened.page.clock.setFixedTime(new Date('2026-11-22T12:00:00Z'));
      await reopened.page.locator('#refresh').click();
      await loaded(reopened.page);
      assert.equal(await reopened.page.locator('#reserveBills').isChecked(), true);
      await reopened.page.close();
    });
    await t.test("paid bill leaves the main list after three days and duplicate creation requires confirmation", async () => {
      const data = fixture();
      data.state.records[2] = { ...data.state.records[2], title: 'Кредит', date: '2026-11-23', settled: '2026-11-19', settledStamp: 3 };
      const { page } = await open(data, 440);
      await loaded(page);
      assert.equal(await page.locator('#bills-paid li').count(), 1);
      await page.clock.setFixedTime(new Date('2026-11-22T12:00:00Z'));
      await page.locator('#refresh').click();
      await loaded(page);
      assert.equal(await page.locator('#bills-paid li').count(), 0);
      await page.locator('#bill').click();
      await page.locator('[name="title"]').fill('Кредит');
      await page.locator('[name="amount"]').fill('2000');
      await page.locator('#submit').click();
      const warning = page.getByRole('dialog', { name: 'Платёж уже оплачивался' });
      await warning.waitFor();
      assert.match(await warning.innerText(), /19 ноября/);
      await warning.getByRole('button', { name: 'Не добавлять', exact: true }).click();
      assert.equal(await page.locator('#dialog').isVisible(), true);
      assert.equal(await page.evaluate(() => window.__budgetFixture.state.records.filter(row => row.type === 'bill').length), 1);
      await page.locator('#submit').click();
      await warning.waitFor();
      await warning.getByRole('button', { name: 'Добавить повторно', exact: true }).click();
      await page.locator('#dialog').waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => window.__budgetFixture.state.records.filter(row => row.type === 'bill').length), 2);
      await page.close();
      const archived = await open(data, 440, '/budget-archive.html?view=bills');
      await loaded(archived.page);
      await archived.page.clock.setFixedTime(new Date('2026-11-22T12:00:00Z'));
      await archived.page.locator('#refresh').click();
      await archived.page.locator('#archiveRows li').waitFor();
      assert.match(await archived.page.locator('#archiveRows').innerText(), /Кредит/);
      await archived.page.locator('#archiveRows').getByRole('button', { name: 'Отменить оплату', exact: true }).click();
      await archived.page.waitForFunction(() => !document.querySelector('#archiveRows li'));
      assert.equal(await archived.page.evaluate(() => window.__budgetFixture.state.records.find(row => row.id === 'bill').settled), null);
      await archived.page.close();
    });
    await t.test("budget help, release warning, anchors and floating button fit desktop and mobile", async () => {
      const { page, errors } = await open(fixture(), 440);
      await loaded(page);
      const help = page.getByRole('link', { name: 'Как работает бюджет', exact: true });
      const box = await help.boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44);
      assert.ok(box.x + box.width <= 440 && box.y + box.height <= 850);
      await help.click();
      await page.waitForURL('**/budget-help.html');
      assert.match(await page.locator('.guide-warning').innerText(), /не доверяйте расчётам полностью/);
      assert.ok(await page.locator('.guide-content section').count() >= 18);
      assert.ok(await page.locator('#faq details').count() >= 12);
      assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.guide-toc a')].map(a => a.hash.slice(1)).filter(id => !document.getElementById(id))), []);
      for (const width of [320, 440, 1440]) {
        await page.setViewportSize({ width, height: width < 500 ? 850 : 1000 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (process.env.BUDGET_SCREENSHOT_DIR) await page.screenshot({ path: process.env.BUDGET_SCREENSHOT_DIR + '/budget-help-' + width + '.png' });
      }
      await page.locator('.guide-toc a[href="#reserve"]').click();
      assert.ok((await page.locator('#reserve').boundingBox()).y >= 65);
      await page.goto(base + '/updates.html');
      const release = page.locator('.updates-release-latest');
      assert.match(await release.innerText(), /Обновление 40\.0/);
      assert.match(await release.innerText(), /активной разработки/);
      assert.equal(await release.locator('a[href="budget-help.html"]').count(), 1);
      assert.deepEqual(errors, []);
      await page.close();
    });
  } finally {
    for (const context of contexts) await context.close();
    await browser.close();
  }
});
