import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("owner hub uses distinct accessible icon navigation", async () => {
  const page = await read("owner.html");
  for (const label of ["Пользователи", "Аналитика", "Идеи", "Состояние системы"]) {
    assert.match(page, new RegExp(`aria-label="${label}"`));
    assert.match(page, new RegExp(`data-tooltip="${label}"`));
  }
  for (const tone of ["users", "analytics", "ideas", "status"]) {
    assert.match(page, new RegExp(`owner-${tone}-link`));
  }
});

test("profile actions keep only icons visible and retain accessible labels", async () => {
  const [page, styles] = await Promise.all([read("profile.html"), read("styles/pages/profile.css")]);
  for (const label of ["Настройки", "Управление", "Выйти"]) {
    assert.match(page, new RegExp(`aria-label="${label}"`));
    assert.match(page, new RegExp(`<span class="sr-only">${label}</span>`));
  }
  assert.match(styles, /\.profile-actions > a\.hidden \{ display: none; \}/);
  assert.ok(
    page.indexOf('id="statusPill"') < page.indexOf('class="profile-actions'),
    "profile status must appear above the action icons",
  );
  assert.match(styles, /@media \(min-width: 640px\)[\s\S]*?\.profile-header-controls \.profile-actions \{ order: -1; \}/);
  assert.match(styles, /profileUpdatesAttention 2\.6s ease-in-out infinite/);
  assert.match(styles, /\.profile-updates-link::before/);
});
