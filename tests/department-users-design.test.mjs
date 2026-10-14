import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("leader controls use dark dates and the existing wine/gold checkbox style", async () => {
  const css = await read("styles/pages/department-users.css");
  assert.match(css, /color-scheme: dark/);
  assert.match(css, /input\[type='date'\]::-webkit-calendar-picker-indicator/);
  assert.match(css, /input\[type='checkbox'\]:checked::after/);
  assert.match(css, /border-color: #c6a15b; background: #7a1638/);
  assert.doesNotMatch(css, /(?:^|\n)(?:button|svg|h1|h2|input|select|dialog)\s*[{,:]/);
});

test("employee dialogs stay bounded and use consistent month/year controls", async () => {
  const [css, html, js] = await Promise.all([
    read("styles/pages/department-users.css"), read("department-users.html"), read("js/department-users.js"),
  ]);
  assert.match(html, /class="employee-dialog"/);
  assert.match(js, /element\("dialog", "", "employee-dialog"\)/);
  assert.match(css, /max-height: calc\(100dvh/);
  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(css, /position: sticky; top: 0/);
  assert.match(js, /month\.addEventListener\("change", refresh\); yearSelect\.addEventListener\("change", refresh\)/);
  assert.match(js, /leaderGetUserTimesheet\(user\.user_id, year, monthIndex\)/);
  assert.doesNotMatch(js, /month\.type = "month"/);
});
