import test from "node:test";
import assert from "node:assert/strict";
import { createHuntState, hashFestiveIdentity, HUNT_PAGES } from "../js/features/festiveHuntModel.js";

test("seasonal controls and stable owner navigation", {
  skip: !process.env.PLAYWRIGHT_MODULE || !process.env.BUDGET_BASE_URL,
}, async t => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const base = process.env.BUDGET_BASE_URL;
  const contexts = [];
  async function open({ date = "2026-12-20T12:00:00+03:00", role = "owner", mode = "auto", width = 1440, reducedMotion = "no-preference", path = "/__seasonal-fixture.html", huntFixture = false, timed = false } = {}) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, reducedMotion, serviceWorkers: "block" });
    contexts.push(context);
    const requests = [];
    await context.addInitScript(({ role, huntFixture, hunt }) => {
      window.__role = role;
      window.__players = [];
      if (huntFixture && !localStorage.getItem(hunt.key)) localStorage.setItem(hunt.key, JSON.stringify(hunt.state));
      window.Audio = class extends EventTarget {
        constructor(src) { super(); this.src = src; this.paused = true; this.currentTime = 0; this.duration = 180; window.__players.push(this); }
        async play() { this.paused = false; this.dispatchEvent(new Event("loadedmetadata")); this.dispatchEvent(new Event("play")); }
        pause() { this.paused = true; this.dispatchEvent(new Event("pause")); }
      };
    }, { role, huntFixture, hunt: { key: `alvisa.festive2026.hunt.${hashFestiveIdentity("test")}`, state: createHuntState(12345, HUNT_PAGES, "index.html") } });
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      requests.push(url.pathname);
      if (url.origin !== new URL(base).origin) return route.abort();
      const fulfill = body => route.fulfill({ contentType: "text/javascript", body });
      if (url.pathname === "/__seasonal-fixture.html" || (huntFixture && HUNT_PAGES.some(path => url.pathname.endsWith('/' + path)))) return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="./styles/tailwind.css"></head><body style="background:#0b0d0f"><div data-app-header data-owner-nav="${mode}"></div><main style="padding:120px 24px;color:#f1eee8"><h1>Рабочая страница</h1><button type="button" style="margin-top:30px">Открыть табель</button></main><script src="./js/pageLoaderBoot.js"></script><script type="module" src="./js/nav.js"></script></body></html>` });
      if (url.pathname === "/js/auth.js") return fulfill('export async function getSession(){return {user:{id:"test"}}}');
      if (url.pathname === "/js/db.js") return fulfill('export async function getMyProfile(){return {role:window.__role,display_name:"Тестовый сотрудник",position:"egais_operator",gender:"male",branch:"chateau_alvisa",employment_date:"2023-01-01",oklad:60000}}');
      if (url.pathname === "/js/errorLogger.js") return fulfill('export function installErrorLogger(){}');
      return route.continue();
    });
    const page = await context.newPage();
    if (timed) {
      await page.clock.install({ time: new Date(date) });
      await page.clock.pauseAt(new Date(date));
    } else await page.clock.setFixedTime(new Date(date));
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base + path);
    await page.locator(".app-top-header").waitFor();
    return { page, requests, errors };
  }
  try {
    await t.test("January 10 midnight removes snow, findings, open greeting and music", async () => {
      const { page, errors } = await open({ date: "2027-01-09T23:59:55+03:00", timed: true, path: "/index.html", huntFixture: true });
      await page.locator('.festive-controls').waitFor();
      await page.getByRole('button', { name: 'Включить новогоднюю музыку', exact: true }).dispatchEvent('click');
      await page.locator('.festive-father-frost').waitFor();
      await page.locator('.festive-father-frost').dispatchEvent('click');
      await page.getByRole('dialog').waitFor();
      await page.clock.runFor(6000);
      assert.equal(await page.locator('.festive-snow, .festive-controls, .festive-find, .festive-greeting').count(), 0);
      assert.equal(await page.evaluate(() => window.__players.every(player => player.paused)), true);
      assert.deepEqual(errors, []);
      await page.close();
    });
    await t.test("three greetings persist, play laughter and stay above the header on mobile", async () => {
      const { page, errors } = await open({ path: "/index.html", huntFixture: true });
      const plan = createHuntState(12345, HUNT_PAGES, "index.html");
      const key = `alvisa.festive2026.hunt.${hashFestiveIdentity("test")}`;
      for (const [index, place] of plan.places.entries()) {
        if (index) await page.goto(base + '/' + place.page);
        const santa = page.getByRole("button", { name: "Дед Мороз с Кантиани — открыть поздравление", exact: true });
        await santa.waitFor();
        await page.waitForFunction(() => document.querySelector('.festive-father-frost img')?.naturalWidth > 0);
        for (const width of [1440, 390, 320]) {
          await page.setViewportSize({ width, height: 700 });
          await page.waitForTimeout(160);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          if (index > 0) {
            const peek = page.locator('.festive-find.is-peeking');
            assert.equal(await peek.count(), 1);
            const visible = await peek.boundingBox();
            assert.equal(visible.width, 54);
            assert.equal(visible.height, 88);
            assert.ok(visible.x >= 0 && visible.x + visible.width <= width);
            if (width === 390 && process.env.SEASONAL_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SEASONAL_SCREENSHOT_DIR}/festive-peek-${index}.png` });
          }
          if (index === 0 && process.env.SEASONAL_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SEASONAL_SCREENSHOT_DIR}/festive-hunt-${width}.png` });
        }
        if (index === 0) await page.getByRole('button', { name: 'Включить новогоднюю музыку', exact: true }).click();
        await santa.click();
        const dialog = page.getByRole('dialog');
        await dialog.waitFor();
        assert.match(await dialog.innerText(), index === 2 ? /Все три праздничных привета/ : new RegExp(`${index + 1} из 3`));
        const rect = await dialog.boundingBox();
        assert.ok(rect.y >= 0 && rect.x >= 0 && rect.x + rect.width <= 320 && rect.y + rect.height <= 700);
        assert.equal(await page.evaluate(() => {
          const close = document.querySelector('.festive-greeting-close');
          const rect = close.getBoundingClientRect();
          return document.elementFromPoint(rect.x + 10, rect.y + 10) === close;
        }), true);
        assert.ok(await page.evaluate(() => window.__players.some(player => player.src.endsWith('/ho-ho-ho-23.mp3') && !player.paused)));
        if (index === 0) {
          assert.equal(await page.evaluate(() => window.__players.find(player => player.src.endsWith('/festive-new-year-160k.mp3')).volume), 0.25);
          assert.equal(await page.evaluate(() => window.__players.find(player => player.src.endsWith('/festive-new-year-160k.mp3')).paused), false);
        }
        if (index === 0 && process.env.SEASONAL_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SEASONAL_SCREENSHOT_DIR}/festive-greeting-mobile.png` });
        if (index === 1) await page.keyboard.press('Escape');
        else await page.getByRole('button', { name: 'Закрыть поздравление', exact: true }).click();
        await dialog.waitFor({ state: 'detached' });
        assert.ok(await page.evaluate(() => window.__players.filter(player => player.src.endsWith('/ho-ho-ho-23.mp3')).every(player => player.paused)));
        if (index === 0) assert.equal(await page.evaluate(() => window.__players.find(player => player.src.endsWith('/festive-new-year-160k.mp3')).volume), 0.25);
        await page.reload();
        await page.locator('.festive-controls').waitFor();
        assert.equal(await santa.count(), 0);
        assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).found.length, key), index + 1);
      }
      assert.deepEqual(errors, []);
      await page.close();
    });
    await t.test("local preview works before December and survives page navigation", async () => {
      const { page } = await open({ date: "2026-11-22T12:00:00+03:00", path: "/index.html?festive-preview=1" });
      await page.locator(".festive-controls").waitFor();
      await page.goto(base + "/__seasonal-fixture.html");
      await page.locator(".festive-controls").waitFor();
      await page.goto(base + "/index.html?festive-preview=0");
      await page.waitForFunction(() => sessionStorage.getItem("alvisa.festive.preview") === "0");
      assert.equal(await page.locator(".festive-controls").count(), 0);
      await page.close();
    });
    await t.test("owner links have identical order with and without pre-rendered Admin", async () => {
      for (const mode of ["auto", "true"]) {
        const { page, errors } = await open({ mode, date: "2026-11-22T12:00:00+03:00" });
        await page.waitForFunction(() => document.querySelector('[data-owner-nav-enhanced="true"]'));
        for (const variant of ["desktop", "mobile"]) {
          const keys = await page.locator(`[data-nav-slot="${variant}"] [data-nav-key]`).evaluateAll(links => links.map(link => link.dataset.navKey));
          assert.deepEqual(keys.slice(-3), ["budget", "owner", "profile"]);
          assert.equal(keys.filter(key => key === "budget").length, 1);
          assert.equal(keys.filter(key => key === "owner").length, 1);
        }
        assert.deepEqual(errors, []);
        await page.close();
      }
    });
    await t.test("outside the window neither seasonal renderer nor audio is loaded", async () => {
      const { page, requests } = await open({ date: "2026-11-22T12:00:00+03:00", role: "user" });
      await page.waitForFunction(() => document.querySelector('[data-nav-slot="desktop"]'));
      assert.equal(await page.locator('[data-nav-key="budget"]').count(), 0);
      assert.equal(await page.locator(".festive-controls").count(), 0);
      assert.equal(requests.some(path => /festiveEvent|festive-event|festive-new-year/.test(path)), false);
      assert.equal(await page.evaluate(() => window.__players.length), 0);
      await page.close();
    });
    await t.test("snow animates, controls fit mobile and music requires consent", async () => {
      const { page, errors } = await open();
      await page.locator(".festive-controls").waitFor();
      assert.equal(await page.evaluate(() => window.__players.length), 0);
      await page.waitForFunction(() => {
        const canvas = document.querySelector(".festive-snow");
        return canvas && [...canvas.getContext("2d").getImageData(0,0,canvas.width,canvas.height).data].some((value, index) => index % 4 === 3 && value > 0);
      });
      const first = await page.locator(".festive-snow").evaluate(canvas => canvas.toDataURL());
      await page.waitForTimeout(100);
      assert.notEqual(await page.locator(".festive-snow").evaluate(canvas => canvas.toDataURL()), first);
      await page.getByRole("button", { name: "Включить новогоднюю музыку", exact: true }).click();
      assert.deepEqual(await page.evaluate(() => window.__players.map(player => ({ paused: player.paused, loop: player.loop }))), [{ paused: false, loop: true }]);
      await page.goto(base + "/__seasonal-fixture.html");
      await page.getByRole("button", { name: "Выключить новогоднюю музыку", exact: true }).waitFor();
      await page.getByRole("button", { name: "Выключить новогоднюю музыку", exact: true }).click();
      assert.equal(await page.evaluate(() => localStorage.getItem("alvisa.festive2026.music")), "0");
      await page.evaluate(async () => {
        const { playBackgroundMusic } = await import("/js/backgroundMusic.js");
        await playBackgroundMusic();
      });
      await page.getByRole("button", { name: "Включить новогоднюю музыку", exact: true }).click();
      assert.equal(await page.evaluate(() => window.__players.filter(player => !player.paused).length), 1);
      await page.getByRole("button", { name: "Выключить снег", exact: true }).click();
      assert.equal(await page.locator(".festive-snow").isVisible(), false);
      await page.getByRole("button", { name: "Включить снег", exact: true }).click();
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 850 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        const box = await page.locator(".festive-controls").boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width && box.y + box.height <= 850);
        if (process.env.SEASONAL_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SEASONAL_SCREENSHOT_DIR}/festive-${width}.png` });
      }
      assert.deepEqual(errors, []);
      await page.close();
    });
    await t.test("reduced motion suppresses falling snow", async () => {
      const { page } = await open({ reducedMotion: "reduce" });
      await page.locator(".festive-controls").waitFor();
      assert.equal(await page.locator(".festive-snow").isVisible(), false);
      assert.equal(await page.locator(".festive-snow-toggle").isDisabled(), true);
      await page.close();
    });
    await t.test("real home renders the event and the supplied MP3 plays after a click", async () => {
      const { page, errors } = await open({ path: "/index.html" });
      await page.locator(".festive-controls").waitFor();
      await page.evaluate(() => {
        window.Audio = function(src) {
          const audio = document.createElement("audio");
          audio.src = src;
          window.__realPlayer = audio;
          return audio;
        };
      });
      await page.getByRole("button", { name: "Включить новогоднюю музыку", exact: true }).click();
      await page.waitForFunction(() => window.__realPlayer && !window.__realPlayer.paused && window.__realPlayer.duration > 0);
      assert.equal(await page.evaluate(() => window.__realPlayer.loop), true);
      await page.waitForFunction(() => !document.documentElement.classList.contains("alvisa-page-loading"));
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 850 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (process.env.SEASONAL_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SEASONAL_SCREENSHOT_DIR}/festive-home-${width}.png` });
      }
      assert.deepEqual(errors, []);
      await page.close();
    });
  } finally {
    for (const context of contexts) await context.close();
    await browser.close();
  }
});
