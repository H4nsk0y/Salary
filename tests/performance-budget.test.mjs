import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const bytes = (path) => statSync(new URL(path, root)).size;

test("static application stays inside conservative size budgets", () => {
  const scripts = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => entry.name);
  const totalScriptBytes = scripts.reduce((total, path) => total + bytes(path), 0);
  const largestScriptBytes = Math.max(...scripts.map(bytes));

  assert.ok(totalScriptBytes <= 920_000, `top-level JavaScript grew to ${totalScriptBytes} bytes`);
  assert.ok(largestScriptBytes <= 150_000, `a JavaScript module grew to ${largestScriptBytes} bytes`);
  assert.ok(bytes("styles/tailwind.css") <= 80_000, "compiled Tailwind CSS exceeded 80 KB");
});

test("retired heavyweight features cannot return through active pages", () => {
  const admin = read("admin.html");
  const support = read("support.html");

  assert.doesNotMatch(admin, /ExcelJS|exceljs|tabel-template/i);
  assert.doesNotMatch(support, /support-game|easter|canvas/i);
  assert.doesNotMatch(read("profile.html"), /easterEggBadge|profile-easter/i);
});

test("profile reads are shared and admin saves only changed employees", () => {
  const db = read("db.js");
  const admin = read("admin.js");

  assert.match(db, /let myProfilePromise = null/);
  assert.match(db, /myProfilePromise = loadMyProfile\(\)/);
  assert.match(admin, /currentSaveItems\(\{ changedOnly: true \}\)/);
  assert.match(admin, /dirtyUserRevisions\.has/);
  assert.match(admin, /sharedMarksRevision/);
});
