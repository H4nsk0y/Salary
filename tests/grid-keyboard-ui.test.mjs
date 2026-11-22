import test from "node:test";
import assert from "node:assert/strict";

test("custom draft commits cells without rebuilding, skips blocked nights and navigates selected hours", {
  skip: !process.env.PLAYWRIGHT_MODULE || !process.env.BUDGET_BASE_URL,
}, async () => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
  const base = process.env.BUDGET_BASE_URL;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    const js = body => route.fulfill({ contentType: 'text/javascript; charset=utf-8', body });
    if (url.origin !== new URL(base).origin) return route.abort();
    if (url.pathname === '/js/auth.js') return js('export async function getSession(){return {user:{id:"test"}}} export const requireSession=getSession;');
    if (url.pathname === '/js/db.js') return js('export async function getMyProfile(){return {role:"owner",display_name:"Тест",position:"egais_operator",gender:"male",branch:"chateau_alvisa",employment_date:"2023-01-01",oklad:60000}}');
    if (url.pathname === '/js/errorLogger.js') return js('export function installErrorLogger(){}');
    if (url.pathname === '/js/productionCalendar.js') return js('export async function getProductionCalendarMonth(year,month){const n=new Date(year,month+1,0).getDate();return {isHoliday:Array(n).fill(false),isTransferredOff:Array(n).fill(false),isShortDay:Array(n).fill(false)}}');
    return route.continue();
  });
  try {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date('2026-11-22T12:00:00+03:00'));
    const errors = [];
    page.on('pageerror', error=>errors.push(error.message));
    await page.goto(base + '/schedule-lab.html');
    await page.waitForFunction(()=>document.querySelector('#labStatus').textContent.includes('готов'));
    await page.waitForFunction(()=>!document.documentElement.classList.contains('alvisa-page-loading'));
    const cell = (row,column)=>page.locator(`#labBody input[data-grid-row="${row}"][data-grid-column="${column}"]`);
    const focused = async (row,column)=>assert.equal(await cell(row,column).evaluate(input=>document.activeElement===input),true);
    await cell(0,0).fill('11');
    const first = await cell(0,0).elementHandle();
    await page.keyboard.press('ArrowRight');
    await focused(0,1);
    assert.equal(await first.evaluate(input=>input.isConnected),true);
    await cell(0,1).fill('11');
    await page.keyboard.press('ArrowRight');
    await focused(0,2);
    await cell(0,2).fill('11');
    await cell(0,0).click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('ArrowRight');
    await focused(0,1);
    assert.deepEqual(await cell(0,1).evaluate(input=>[input.selectionStart,input.selectionEnd]),[0,2]);
    await page.keyboard.press('ArrowRight');
    await focused(0,2);
    await page.keyboard.press('ArrowLeft');
    await focused(0,1);
    await page.keyboard.press('ArrowLeft');
    await focused(0,0);
    await page.keyboard.press('ArrowDown');
    await focused(1,0);
    await cell(1,0).fill('2');
    await page.keyboard.press('ArrowDown');
    await focused(2,0);
    await page.keyboard.press('ArrowUp');
    await focused(1,0);
    await page.keyboard.press('ArrowUp');
    await focused(0,0);
    await cell(0,0).fill('ОТ');
    await page.keyboard.press('ArrowDown');
    await focused(2,0);
    assert.equal(await cell(1,0).isDisabled(),true);
    assert.equal(await cell(1,0).inputValue(),'');
    assert.equal(await cell(0,0).inputValue(),'ОТ');
    await cell(0,1).fill('99');
    await page.keyboard.press('ArrowRight');
    await focused(0,2);
    assert.equal(await cell(0,1).inputValue(),'11');
    assert.match(await page.locator('#labStatus').innerText(),/не может быть больше 24/);
    assert.deepEqual(errors,[]);
  } finally {
    await context.close();
    await browser.close();
  }
});
