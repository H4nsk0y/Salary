import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("Supabase requests drive one shared initial loading screen", async () => {
  const [loader, boot, styles, network, nav, profile] = await Promise.all([
    read("js/pageLoader.js"),
    read("js/pageLoaderBoot.js"),
    read("styles/page-loader.css"),
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
  assert.match(loader, /Проверьте VPN/);
  assert.match(loader, /Обновить страницу/);
  assert.match(loader, /hydrateLoader/);
  assert.match(loader, /is-active/);
  assert.match(loader, /alvisa-loader-primed/);
  assert.match(boot, /alvisa-loader-primed/);
  assert.match(boot, /__alvisaLoaderSafetyTimer/);
  assert.match(boot, /Не удалось запустить страницу/);
  assert.match(styles, /alvisa-loader-primed/);
  assert.match(styles, /alvisa-loader-breathe/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(profile, /Загружаем личный кабинет/);
  assert.match(profile, /finishPageDataRequest\(profilePageLoadToken, \{ failed: true \}\)/);
});

test("application pages prime the loader before their visible content", async () => {
  const root = new URL("../", import.meta.url);
  const pages = (await readdir(root)).filter((name) => name.endsWith(".html") && name !== "offline.html");

  for (const page of pages) {
    const html = await read(page);
    assert.match(html, /styles\/page-loader\.css/, `${page} must load critical loader styles`);
    assert.match(html, /id="alvisaPageLoader"/, `${page} must contain the early loader root`);
    assert.match(html, /js\/pageLoaderBoot\.js/, `${page} must run the early loader boot script`);
    const bodyStart = html.match(/<body[^>]*>/i);
    assert.ok(bodyStart, `${page} must have a body`);
    const bodyContent = html.slice((bodyStart.index || 0) + bodyStart[0].length);
    assert.match(bodyContent, /^\s*<div id="alvisaPageLoader"/, `${page} must start with the loader`);
  }
});
