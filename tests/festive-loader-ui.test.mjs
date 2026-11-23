import assert from "node:assert/strict";
import test from "node:test";

test("loading screen uses the decorated building only during the event or local preview", {
  skip: !process.env.PLAYWRIGHT_MODULE || !process.env.BUDGET_BASE_URL,
}, async t => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const base = process.env.BUDGET_BASE_URL;
  const contexts = [];
  async function open({ date = "2026-12-10T12:00:00+03:00", preview = false, failImage = false, width = 1440, reducedMotion = "no-preference" } = {}) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, reducedMotion, serviceWorkers: "block" });
    contexts.push(context);
    const requests = [];
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      requests.push(url.pathname);
      if (url.pathname === "/__festive-loader.html") return route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="./styles/page-loader.css"></head><body><div id="alvisaPageLoader" class="alvisa-page-loader is-active"></div><script src="./js/pageLoaderBoot.js"></script></body></html>' });
      if (url.pathname.endsWith("/festiveEvent.js")) return route.fulfill({ contentType: "text/javascript", body: 'export function mountFestiveEvent(){return ()=>{}}' });
      if (failImage && url.pathname.endsWith("/festive-loader-v1.webp")) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(date));
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${base}/__festive-loader.html${preview ? '?festive-preview=1' : ''}`);
    await page.waitForFunction(() => document.querySelector('.alvisa-page-loader-icon')?.naturalWidth > 0);
    return { page, errors, requests };
  }
  try {
    await t.test("regular dates keep the original building and do not load the festive image", async () => {
      const { page, requests, errors } = await open({ date: "2026-11-23T12:00:00+03:00" });
      assert.match(await page.locator('.alvisa-page-loader-icon').getAttribute('src'), /app-icon-512\.png$/);
      assert.equal(requests.some(path => path.endsWith('/festive-loader-v1.webp')), false);
      assert.deepEqual(errors, []);
      await page.close();
    });
    await t.test("decorated building remains readable on desktop and mobile and still pulses", async () => {
      const { page, requests, errors } = await open();
      assert.match(await page.locator('.alvisa-page-loader-icon').getAttribute('src'), /festive-loader-v1\.webp$/);
      assert.equal(requests.some(path => path.endsWith('/app-icon-512.png')), false);
      assert.equal(await page.locator('.alvisa-page-loader-icon').evaluate(image => getComputedStyle(image).animationName), 'alvisa-loader-breathe');
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 850 });
        const box = await page.locator('.alvisa-page-loader-icon').boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (process.env.SEASONAL_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SEASONAL_SCREENSHOT_DIR}/festive-loader-${width}.png` });
      }
      assert.deepEqual(errors, []);
      await page.close();
    });
    await t.test("local preview activates the holiday image early and reduced motion is respected", async () => {
      const { page } = await open({ date: "2026-11-23T12:00:00+03:00", preview: true, reducedMotion: "reduce" });
      assert.match(await page.locator('.alvisa-page-loader-icon').getAttribute('src'), /festive-loader-v1\.webp$/);
      assert.equal(await page.locator('.alvisa-page-loader-icon').evaluate(image => getComputedStyle(image).animationName), 'alvisa-loader-fade');
      await page.close();
    });
    await t.test("January 10 uses the ordinary image again", async () => {
      const { page } = await open({ date: "2027-01-10T00:00:00+03:00" });
      assert.match(await page.locator('.alvisa-page-loader-icon').getAttribute('src'), /app-icon-512\.png$/);
      await page.close();
    });
    await t.test("a failed holiday image falls back without breaking the loader", async () => {
      const { page, errors } = await open({ failImage: true });
      assert.match(await page.locator('.alvisa-page-loader-icon').getAttribute('src'), /app-icon-512\.png$/);
      assert.equal(await page.locator('.alvisa-page-loader-icon').evaluate(image => image.classList.contains('is-festive')), false);
      assert.deepEqual(errors, []);
      await page.close();
    });
  } finally {
    for (const context of contexts) await context.close();
    await browser.close();
  }
});
