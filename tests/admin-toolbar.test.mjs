import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("admin actions use compact accessible icon buttons", async () => {
  const [page, styles] = await Promise.all([read("admin.html"), read("styles/pages/admin.css")]);
  for (const id of ["reloadBtn", "saveBtn", "saveSilentBtn", "auditLogBtn", "announcementLink", "createInviteBtn"]) {
    assert.match(page, new RegExp(`id="${id}"[\\s\\S]{0,250}class="[^"]*admin-icon-action`));
  }
  assert.match(styles, /\.admin-icon-action::after/);
  assert.match(styles, /content: attr\(data-tooltip\)/);
  assert.match(styles, /\.admin-icon-action\.hidden/);
});

test("home workspace cards use separated current-design surfaces", async () => {
  const page = await read("index.html");
  assert.match(page, /\.workspace-grid\s*\{[\s\S]*?gap: 12px/);
  assert.match(page, /\.workspace-link\s*\{[\s\S]*?border-radius: 8px/);
  assert.match(page, /padding-bottom: clamp\(3rem, 5vw, 5rem\)/);
});
