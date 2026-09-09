import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isSearchEasterEgg, searchSiteEntries } from "../siteSearch.js";

const read = (fileName) => readFile(new URL(`../${fileName}`, import.meta.url), "utf8");

test("site search finds features by ordinary Russian wording", () => {
  assert.equal(searchSiteEntries("зарплата")[0]?.href, "calculator.html");
  assert.equal(searchSiteEntries("коды отсутствия")[0]?.href, "help.html#codes");
  assert.equal(searchSiteEntries("35 часов")[0]?.href, "profile.html");
});

test("owner-only destinations are hidden from ordinary search", () => {
  assert.deepEqual(searchSiteEntries("размер базы"), []);
  assert.equal(searchSiteEntries("размер базы", { isOwner: true })[0]?.href, "owner-status.html");
});

test("search query has its own easter egg", () => {
  assert.equal(isSearchEasterEgg("Поиск"), true);
  assert.equal(isSearchEasterEgg("  поиск  "), true);
  assert.equal(isSearchEasterEgg("поиск по сайту"), false);
});

test("search easter egg opens the requested image result safely", async () => {
  const search = await read("siteSearch.js");
  assert.match(search, /i\.pinimg\.com\/originals\/4d\/5e\/24\/4d5e242dc61c09864ffa546fe8c14c95\.png\?nii=t/);
  assert.match(search, /message\.target = "_blank"/);
  assert.match(search, /message\.rel = "noopener noreferrer"/);
});

test("common header places search beside notifications and keeps browser Ctrl+F", async () => {
  const [nav, search] = await Promise.all([read("nav.js"), read("siteSearch.js")]);
  assert.match(nav, /siteSearch\.element, createNotificationsWidget\(\), menuButton/);
  assert.match(search, /event\.key\.toLowerCase\(\) !== "k"/);
  assert.doesNotMatch(search, /event\.key\.toLowerCase\(\) !== "f"/);
  assert.match(search, /aria-label", "Поиск по сайту"/);
});

test("project guidance permanently excludes timesheet automation suggestions", async () => {
  const guidance = await read("docs/AGENTS.md");
  assert.match(guidance, /## Больше не предлагать/);
  assert.match(guidance, /Автоматическое составление или автоматическое заполнение табелей/);
  assert.match(guidance, /Шаблоны смен, пресеты смен/);
});
