import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  isValidCustomPosition,
  normalizeCustomPosition,
  validateCustomPositionSelection,
} from "../js/profilePosition.js";

const departments = new Set(["egais", "warehouse", "operations"]);

test("custom position accepts a realistic department position", () => {
  assert.deepEqual(
    validateCustomPositionSelection({
      department: "operations",
      position: "  Инженер   по автоматизации  ",
      allowedDepartments: departments,
    }),
    { ok: true, department: "operations", position: "Инженер по автоматизации" }
  );
});

test("custom position accepts short ordinary job names", () => {
  assert.equal(isValidCustomPosition("Механик"), true);
  assert.equal(normalizeCustomPosition(" Старший   кладовщик "), "Старший кладовщик");
});

test("custom position rejects missing or unknown department", () => {
  assert.equal(
    validateCustomPositionSelection({ position: "Механик", allowedDepartments: departments }).field,
    "department"
  );
  assert.equal(
    validateCustomPositionSelection({
      department: "unknown",
      position: "Механик",
      allowedDepartments: departments,
    }).field,
    "department"
  );
});

test("custom position rejects markup, control characters and invalid length", () => {
  for (const value of ["A", "<script>", `Инженер${String.fromCharCode(0)}АСУ`, "Я".repeat(81)]) {
    assert.equal(isValidCustomPosition(value), false, value);
  }
});

test("profile gets the allowed catalog and submits proposals separately from profile updates", async () => {
  const source = await readFile(new URL("../js/profile.js", import.meta.url), "utf8");
  assert.match(source, /getProfilePositionOptions\(\)/);
  assert.match(source, /positionCatalog\.department_key \? positionSelect : document\.createElement\("optgroup"\)/);
  assert.match(source, /await submitDepartmentPositionProposal\(result\.department, result\.position\)/);
  assert.match(source, /position: positionChanged \? position \|\| null : undefined/);
});
