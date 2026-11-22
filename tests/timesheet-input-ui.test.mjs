import test from "node:test";
import assert from "node:assert/strict";

test("timesheet ignores restored focus/autofill but accepts pointer, Tab and arrow editing", {
  skip: !process.env.PLAYWRIGHT_MODULE || !process.env.BUDGET_BASE_URL,
}, async () => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const context = await browser.newContext();
  const base = process.env.BUDGET_BASE_URL;
  await context.route('**/__input-guard.html', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><button id="before">Табель</button><div id="grid"></div><button id="after">Далее</button>' }));
  try {
    const page = await context.newPage();
    await page.goto(base + '/__input-guard.html');
    await page.evaluate(async () => {
      const { hardenTimesheetInput, rejectUnexpectedTimesheetAutofill } = await import('./js/timesheetInput.js?v=20261122-1');
      const { shouldNavigateGrid } = await import('./js/features/gridKeyboard.js');
      window.__saved = [];
      window.__focuses = [];
      const grid = document.querySelector('#grid');
      for (let index = 0; index < 31; index++) {
        const input = document.createElement('input');
        input.id = `day-${index + 1}`;
        input.value = index === 30 ? '11' : '';
        input.dataset.prev = input.value;
        hardenTimesheetInput(input, { requireEditingIntent: true });
        input.addEventListener('focus', () => window.__focuses.push(input.id));
        input.addEventListener('input', () => {
          if (rejectUnexpectedTimesheetAutofill(input)) return;
          input.dataset.prev = input.value;
          window.__saved.push(input.value);
        });
        input.addEventListener('keydown', event => {
          if (event.key !== 'ArrowRight' || !shouldNavigateGrid(event, input)) return;
          const next = document.querySelector(`#day-${index + 2}`);
          next?.focus();
          next?.select();
          event.preventDefault();
        });
        grid.append(input);
      }
    });
    await page.evaluate(() => {
      const last = document.querySelector('#day-31');
      last.value = '89633757579';
      last.focus();
      last.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: '89633757579' }));
    });
    assert.equal(await page.locator('#day-31').inputValue(), '11');
    assert.notEqual(await page.evaluate(() => document.activeElement.id), 'day-31');
    assert.deepEqual(await page.evaluate(() => window.__saved), []);
    assert.deepEqual(await page.evaluate(() => window.__focuses), []);

    await page.locator('#day-1').click();
    await page.keyboard.insertText('8');
    assert.equal(await page.locator('#day-1').inputValue(), '8');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'day-2');
    await page.keyboard.insertText('ОТ');
    assert.equal(await page.locator('#day-2').inputValue(), 'ОТ');
    await page.locator('#before').click();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'day-1');
    assert.equal(await page.locator('#day-1').evaluate(input => input.readOnly), false);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'day-2');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'day-1');
    await page.locator('#after').click();
    assert.equal(await page.locator('#day-1').evaluate(input => input.readOnly), true);
    assert.deepEqual(await page.evaluate(() => window.__saved), ['8','ОТ']);
    await page.locator('#day-1').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'day-2');
    assert.deepEqual(await page.locator('#day-2').evaluate(input=>[input.selectionStart,input.selectionEnd]),[0,2]);
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'day-3');
  } finally {
    await context.close();
    await browser.close();
  }
});
