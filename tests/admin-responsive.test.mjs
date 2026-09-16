import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const html = await readFile(path.join(process.cwd(), "admin.html"), "utf8");

test("mobile employee cells hide the overtime badge after desktop styles", () => {
  assert.match(html, /@media \(max-width: 767px\) \{\s*\.admin-matrix \.label-overtime-badge:not\(\.is-hidden\) \{\s*display: none;/);
});

test("summary values remain on one line in the wider mobile summary column", () => {
  assert.match(html, /\.summary-main strong,\s*\.summary-line strong \{\s*flex-shrink: 0;\s*white-space: nowrap;/);
  assert.match(html, /\.admin-matrix \.summary-head,\s*\.admin-matrix \.summary-cell \{\s*min-width: 230px;\s*width: 230px;/);
});

test("mobile action groups are centered and only touch screens disable the sticky scrollbar", () => {
  assert.match(html, /\.admin-tool-groups \{\s*width: 100%;\s*justify-content: center;/);
  assert.match(html, /\.admin-action-buttons \{\s*width: 100%;\s*justify-content: center;/);
  assert.match(html, /\.top-table-scroll \{\s*position: sticky;\s*top: calc\(148px \+ env\(safe-area-inset-top, 0px\)\);/);
  assert.match(html, /@media \(hover: none\) and \(pointer: coarse\) \{\s*\.top-table-scroll \{\s*position: relative;/);
});
