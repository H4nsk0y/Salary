import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("frozen tasks and instructions are absent from entry points", () => {
  for (const path of ["nav.js", "index.html", "manifest.webmanifest"]) {
    const source = read(path);
    assert.doesNotMatch(source, /tasks\.html/);
    assert.doesNotMatch(source, /instructions\.html/);
  }
});

test("frozen pages redirect before loading application modules", () => {
  for (const path of ["tasks.html", "instructions.html"]) {
    const source = read(path);
    assert.match(source, /location\.replace\("\.\/index\.html"\)/);
    assert.doesNotMatch(source, /<script type="module"/);
  }
});
