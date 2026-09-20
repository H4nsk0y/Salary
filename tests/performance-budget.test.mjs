import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const bytes = (path) => statSync(new URL(path, root)).size;

function listJavaScriptFiles(directory = "js") {
  return readdirSync(new URL(`${directory}/`, root), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return listJavaScriptFiles(path);
    return entry.isFile() && entry.name.endsWith(".js") ? [path] : [];
  });
}

test("static application stays inside conservative size budgets", () => {
  const scripts = listJavaScriptFiles();
  const totalScriptBytes = scripts.reduce((total, path) => total + bytes(path), 0);
  const largestScriptBytes = Math.max(...scripts.map(bytes));

  assert.ok(totalScriptBytes <= 1_200_000, `application JavaScript grew to ${totalScriptBytes} bytes`);
  assert.ok(largestScriptBytes <= 150_000, `a JavaScript module grew to ${largestScriptBytes} bytes`);
  assert.ok(bytes("styles/tailwind.css") <= 80_000, "compiled Tailwind CSS exceeded 80 KB");
  for (const page of ["admin", "calculator", "profile", "table"]) {
    assert.ok(bytes(`styles/pages/${page}.css`) <= 60_000, `${page} page CSS exceeded 60 KB`);
  }
});

test("rare features stay outside the initial page load", () => {
  for (const page of ["calculator", "profile", "table"]) {
    const html = read(`${page}.html`);
    assert.doesNotMatch(html, /driver\.min\.(?:css|js)/);
    assert.doesNotMatch(html, /styles\/tour\.css/);
    assert.match(html, /features\/tourBootstrap\.js/);
  }

  assert.doesNotMatch(read("js/table.js"), /^import .*payslipImport/m);
  assert.match(read("js/table.js"), /await import\("\.\/payslipImport\.js/);

  const nav = read("js/nav.js");
  assert.match(nav, /^import \{ createSiteSearchWidget \} from "\.\/siteSearch\.js";/m);
  assert.match(nav, /await import\("\.\/features\/navigationNotifications\.js/);
  assert.match(nav, /import\("\.\/idleScreenSaver\.js/);
});

test("page behavior is cacheable and common modules are not connected twice", () => {
  const htmlFiles = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => entry.name);

  for (const file of htmlFiles) {
    const html = read(file);
    assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc=)[^>]*>/i, `${file} contains inline JavaScript`);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${file} contains an inline event handler`);
    if (html.includes("script-src")) {
      assert.doesNotMatch(html, /script-src[^;]*'unsafe-inline'/, `${file} permits inline JavaScript`);
    }
    if (!["calculator.html", "profile.html", "table.html"].includes(file)) {
      assert.doesNotMatch(html, /unpkg\.com/, `${file} permits the tour CDN without using tours`);
    }
    if (html.includes("./js/nav.js")) {
      assert.doesNotMatch(html, /src="\.\/js\/footer\.js/, `${file} connects the common footer twice`);
    }
  }

  const calculator = read("calculator.html");
  assert.match(calculator, /features\/calculatorPrivacy\.js/);
  assert.doesNotMatch(calculator, /attachPeek|attachResultsToggle/);
});

test("money animations reuse formatters and cancel stale frames", () => {
  for (const file of ["js/app.js", "js/table.js"]) {
    const script = read(file);
    assert.match(script, /const rubFormatters = new Map\(\)/);
    assert.match(script, /const numberAnimationFrames = new WeakMap\(\)/);
    assert.match(script, /cancelAnimationFrame\(activeFrame\)/);
  }
});

test("retired heavyweight features cannot return through active pages", () => {
  const admin = read("admin.html");
  const support = read("support.html");

  assert.doesNotMatch(admin, /ExcelJS|exceljs|tabel-template/i);
  assert.doesNotMatch(support, /support-game|easter|canvas/i);
  assert.doesNotMatch(read("profile.html"), /easterEggBadge|profile-easter/i);
});

test("profile reads are shared and admin saves only changed employees", () => {
  const db = read("js/db.js");
  const admin = read("js/admin.js");

  assert.match(db, /let myProfilePromise = null/);
  assert.match(db, /myProfilePromise = loadMyProfile\(\)/);
  assert.match(admin, /currentSaveItems\(\{ changedOnly: true \}\)/);
  assert.match(admin, /dirtyUserRevisions\.has/);
  assert.match(admin, /sharedMarksRevision/);
});
