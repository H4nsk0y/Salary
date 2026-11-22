import test from "node:test";
import assert from "node:assert/strict";

test("real service worker streams music, reuses it offline and serves byte ranges", {
  skip: !process.env.PLAYWRIGHT_MODULE || !process.env.BUDGET_BASE_URL,
}, async () => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const context = await browser.newContext({ serviceWorkers: "allow" });
  try {
    const page = await context.newPage();
    await page.goto(process.env.BUDGET_BASE_URL + "/offline.html");
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("./service-worker.js");
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    await page.evaluate(() => {
      const button = document.createElement("button");
      button.id = "testMusic";
      button.textContent = "Play";
      window.__audio = new Audio("./media/festive-new-year-160k.mp3");
      button.onclick = () => window.__audio.play();
      document.body.append(button);
    });
    await page.locator("#testMusic").click();
    await page.waitForFunction(() => !window.__audio.paused && window.__audio.duration > 120);
    await page.waitForFunction(async () => {
      const cache = await caches.open("alvisa-pwa-runtime-v8");
      return Boolean(await cache.match(new URL("./media/festive-new-year-160k.mp3", location.href).href));
    });
    await page.evaluate(async () => {
      const image = new Image();
      image.src = "./images/festive-ded-moroz-144.webp";
      await image.decode();
    });
    await page.waitForFunction(async () => Boolean(await (await caches.open("alvisa-pwa-runtime-v8")).match(new URL("./images/festive-ded-moroz-144.webp", location.href).href)));
    const cached = await page.evaluate(async () => {
      const url = new URL("./media/festive-new-year-160k.mp3", location.href).href;
      const response = await (await caches.open("alvisa-pwa-runtime-v8")).match(new Request(url));
      return { controlled: navigator.serviceWorker.controller.scriptURL, status: response?.status, size: response ? (await response.arrayBuffer()).byteLength : 0 };
    });
    assert.equal(cached.status, 200, JSON.stringify(cached));
    assert.ok(cached.size > 2_000_000);
    await context.setOffline(true);
    const result = await page.evaluate(async () => {
      const url = "./media/festive-new-year-160k.mp3";
      const full = await (await fetch(url)).arrayBuffer();
      const part = await fetch(url, { headers: { Range: "bytes=0-99" } });
      const bytes = new Uint8Array(await part.arrayBuffer());
      const image = new Image();
      image.src = "./images/festive-ded-moroz-144.webp";
      await image.decode();
      window.__audio.currentTime = 120;
      return { status: part.status, length: bytes.length, range: part.headers.get("Content-Range"), same: bytes.every((value, index) => value === new Uint8Array(full)[index]), width: image.naturalWidth };
    });
    assert.equal(result.status, 206);
    assert.equal(result.length, 100);
    assert.match(result.range, /^bytes 0-99\//);
    assert.equal(result.same, true);
    assert.equal(result.width, 144);
    await page.waitForFunction(() => window.__audio.currentTime >= 120 && !window.__audio.seeking);
  } finally {
    await context.close();
    await browser.close();
  }
});
