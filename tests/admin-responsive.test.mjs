import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const html = await readFile(path.join(process.cwd(), "admin.html"), "utf8");
const styles = await readFile(path.join(process.cwd(), "styles/pages/admin.css"), "utf8");

test("mobile employee cells hide the overtime badge after desktop styles", () => {
  assert.match(styles, /@media \(max-width: 767px\) \{\s*\.admin-matrix \.label-overtime-badge:not\(\.is-hidden\) \{\s*display: none;/);
});

test("summary values remain on one line in the wider mobile summary column", () => {
  assert.match(styles, /\.summary-main strong,\s*\.summary-line strong \{\s*flex-shrink: 0;\s*white-space: nowrap;/);
  assert.match(styles, /\.admin-matrix \.summary-head,\s*\.admin-matrix \.summary-cell \{\s*min-width: 230px;\s*width: 230px;/);
});

test("mobile action groups are centered and only touch screens disable the sticky scrollbar", () => {
  assert.match(styles, /\.admin-tool-groups \{\s*width: 100%;\s*justify-content: center;/);
  assert.match(styles, /\.admin-action-buttons \{\s*width: 100%;\s*justify-content: center;/);
  assert.match(styles, /\.top-table-scroll \{\s*position: sticky;\s*top: calc\(148px \+ env\(safe-area-inset-top, 0px\)\);/);
  assert.match(styles, /@media \(hover: none\) and \(pointer: coarse\) \{\s*\.top-table-scroll \{\s*position: relative;/);
});
