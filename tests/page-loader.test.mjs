import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("Supabase requests drive one shared initial loading screen", async () => {
  const [loader, network, nav, profile] = await Promise.all([
    read("js/pageLoader.js"),
    read("js/networkNotice.js"),
    read("js/nav.js"),
    read("js/profile.js"),
  ]);

  assert.match(nav, /beginPageDataRequest, finishPageDataRequest/);
  assert.match(nav, /critical:\s*true/);
  assert.match(nav, /persistedSessionOnly:\s*true/);
  assert.match(network, /beginPageDataRequest\(\)/);
  assert.match(network, /finishPageDataRequest\(pageLoadToken/);
  assert.match(network, /response\?\.status\) >= 500/);
  assert.match(loader, /app-icon-512\.png/);
  assert.match(loader, /role="progressbar"/);
  assert.match(loader, /data-loader-percent/);
  assert.match(loader, /aria-valuenow/);
  assert.match(loader, /criticalLoadFailed/);
  assert.match(loader, /criticalLoadFailed \|\| initialLoadFailed/);
  assert.match(loader, /Применяем данные/);
  assert.match(loader, /alvisa-loader-breathe/);
  assert.match(loader, /Проверьте VPN/);
  assert.match(loader, /Обновить страницу/);
  assert.match(loader, /prefers-reduced-motion/);
  assert.match(profile, /Загружаем личный кабинет/);
  assert.match(profile, /finishPageDataRequest\(profilePageLoadToken, \{ failed: true \}\)/);
});
