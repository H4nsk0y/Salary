import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("screen wake preference is shared by pages through the common navigation", async () => {
  const [wakeLock, nav, settings, page] = await Promise.all([
    source("js/screenWakeLock.js"),
    source("js/nav.js"),
    source("js/settings.js"),
    source("settings.html"),
  ]);

  assert.match(nav, /if \(profile\?\.user_id\) \{[\s\S]*import\("\.\/screenWakeLock\.js"\)[\s\S]*startScreenWakeLock/);
  assert.match(wakeLock, /navigator\.wakeLock\.request\("screen"\)/);
  assert.match(wakeLock, /visibilitychange/);
  assert.match(wakeLock, /alvisa\.keepScreenAwake\.v1/);
  assert.match(wakeLock, /export function startScreenWakeLock/);
  assert.match(settings, /startScreenWakeLock\(\)/);
  assert.match(settings, /setScreenWakeEnabled/);
  assert.match(page, /id="screenWakeToggle"/);
});

test("screen wake setting clearly handles unsupported browsers", async () => {
  const [wakeLock, settings] = await Promise.all([
    source("js/screenWakeLock.js"),
    source("js/settings.js"),
  ]);

  assert.match(wakeLock, /supported: isSupported\(\)/);
  assert.match(settings, /Этот браузер не поддерживает удержание экрана активным/);
  assert.match(settings, /системная политика/);
});
