import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("Supabase requests drive one shared initial loading screen", async () => {
  const [loader, network, nav] = await Promise.all([
    read("js/pageLoader.js"),
    read("js/networkNotice.js"),
    read("js/nav.js"),
  ]);

  assert.match(nav, /^import "\.\/pageLoader\.js";/);
  assert.match(network, /beginPageDataRequest\(\)/);
  assert.match(network, /finishPageDataRequest\(pageLoadToken/);
  assert.match(loader, /app-icon-512\.png/);
  assert.match(loader, /role="progressbar"/);
  assert.match(loader, /alvisa-loader-breathe/);
  assert.match(loader, /Проверьте VPN/);
  assert.match(loader, /Обновить страницу/);
  assert.match(loader, /prefers-reduced-motion/);
});
