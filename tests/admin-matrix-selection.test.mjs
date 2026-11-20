import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getMatrixSelectionBounds,
  isMatrixCellInBounds,
  sumMatrixSelectionHours,
} from "../js/features/matrixSelection.js";

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("selected hours include day and night without leave codes or rounding noise", () => {
  const state = { dayHours: [7.2, 2, 0], nightHours: [0, 5, 0] };
  assert.equal(sumMatrixSelectionHours([
    { state, rowType: "day", index: 0 }, { state, rowType: "day", index: 1 },
    { state, rowType: "night", index: 1 }, { state, rowType: "day", index: 2 },
  ]), 14.2);
  assert.equal(sumMatrixSelectionHours([]), 0);
});
test("matrix selection creates a rectangle in either drag direction", () => {
  const bounds = getMatrixSelectionBounds(
    { rowIndex: 5, columnIndex: 8 },
    { rowIndex: 2, columnIndex: 3 },
  );

  assert.deepEqual(bounds, { minRow: 2, maxRow: 5, minColumn: 3, maxColumn: 8 });
  assert.equal(isMatrixCellInBounds({ rowIndex: 4, columnIndex: 6 }, bounds), true);
  assert.equal(isMatrixCellInBounds({ rowIndex: 6, columnIndex: 6 }, bounds), false);
});

test("admin matrix supports mouse range clearing without touching comments", async () => {
  const [admin, page, styles] = await Promise.all([
    read("js/admin.js"),
    read("admin.html"),
    read("styles/pages/admin.css"),
  ]);

  assert.match(admin, /function startMatrixSelection/);
  assert.match(admin, /event\.key !== "Delete" && event\.key !== "Backspace"/);
  assert.match(admin, /clearSelectedMatrixCells/);
  assert.match(admin, /scheduleSave\(\{ state \}\)/);
  assert.doesNotMatch(admin.match(/function clearSelectedMatrixCells\(\)[\s\S]*?\n\}/)?.[0] || "", /shiftComments/);
  assert.match(styles, /td\.matrix-cell-selected::after/);
});
