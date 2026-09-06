import test from "node:test";
import assert from "node:assert/strict";
import { buildClientErrorsCsv, classifyClientError } from "../clientErrorInsights.js";

test("explains opaque cross-origin script errors honestly", () => {
  const result = classifyClientError({ message: "Script error.", kind: "window_error" });
  assert.equal(result.code, "JS-OPAQUE-001");
  assert.match(result.explanation, /нельзя достоверно/i);
});

test("classifies Array.from failures", () => {
  const result = classifyClientError({ message: "Array.from requires an array-like object - not null or undefined" });
  assert.equal(result.code, "JS-LIST-001");
});

test("CSV export neutralizes spreadsheet formulas", () => {
  const csv = buildClientErrorsCsv([{ display_name: "=CMD()", message: "Ошибка", context: {} }]);
  assert.match(csv, /"'=CMD\(\)"/);
});
