import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPayDifferenceInsight } from "../payDifference.js";

test("reports whether the employee received more and finds the largest component", () => {
  const result = buildPayDifferenceInsight({
    actual: { net: 52_000, advance: 20_000, remaining: 32_000 },
    calculated: { net: 50_000, advance: 19_500, remaining: 30_500 },
  });

  assert.equal(result.direction, "more");
  assert.equal(result.amount, 2_000);
  assert.deepEqual(result.largest, {
    label: "остатке",
    signed: 1_500,
    amount: 1_500,
    direction: "more",
  });
});

test("reports whether the employee received less", () => {
  const result = buildPayDifferenceInsight({
    actual: { net: 47_000, advance: 10_000, remaining: 37_000 },
    calculated: { net: 50_000, advance: 10_000, remaining: 40_000 },
  });

  assert.equal(result.direction, "less");
  assert.equal(result.amount, 3_000);
  assert.equal(result.largest.label, "остатке");
  assert.equal(result.largest.direction, "less");
});

test("includes vacation pay only when a comparable estimate exists", () => {
  const withoutEstimate = buildPayDifferenceInsight({
    actual: { net: 50_000, paidLeaveNet: 15_000 },
    calculated: { net: 50_000 },
  });
  assert.equal(withoutEstimate.amount, 0);
  assert.equal(withoutEstimate.largest, null);

  const withEstimate = buildPayDifferenceInsight({
    actual: { net: 50_000, paidLeaveNet: 15_000 },
    calculated: { net: 50_000 },
    paidLeaveEstimate: 12_000,
  });
  assert.equal(withEstimate.amount, 3_000);
  assert.equal(withEstimate.largest.label, "отпускных");
});

test("keeps component differences when the total happens to match", () => {
  const result = buildPayDifferenceInsight({
    actual: { net: 50_000, advance: 21_000, remaining: 29_000 },
    calculated: { net: 50_000, advance: 20_000, remaining: 30_000 },
  });

  assert.equal(result.direction, "equal");
  assert.equal(result.amount, 0);
  assert.equal(result.largest.amount, 1_000);
});
