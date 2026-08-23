import assert from "node:assert/strict";
import { test } from "node:test";
import { getNightSequenceDisplay, isWorkDepartureDay } from "../timesheetView.js";

test("single night is shown as a full night followed by a rest day", () => {
  const day = [2, 2];
  const night = [2, 5];
  assert.deepEqual(getNightSequenceDisplay(day, night, 0), {
    kind: "night", hours: 11, label: "Ночная смена · 11 ч", compactLabel: "Н 11",
  });
  assert.equal(getNightSequenceDisplay(day, night, 1)?.kind, "rest");
});

test("consecutive nights are shown as nights until the final rest day", () => {
  const day = [2, 4, 2];
  const night = [2, 7, 5];
  assert.equal(getNightSequenceDisplay(day, night, 0)?.compactLabel, "Н 11");
  assert.equal(getNightSequenceDisplay(day, night, 1)?.compactLabel, "Н 11");
  assert.equal(getNightSequenceDisplay(day, night, 2)?.compactLabel, "Отс.");
});

test("reduced female night pattern is presented as ten hours", () => {
  const day = [2, 3, 1];
  const night = [2, 7, 5];
  assert.equal(getNightSequenceDisplay(day, night, 0)?.hours, 10);
  assert.equal(getNightSequenceDisplay(day, night, 1)?.hours, 10);
  assert.equal(getNightSequenceDisplay(day, night, 2)?.kind, "rest");
});

test("ordinary day and evening shifts keep their raw presentation", () => {
  assert.equal(getNightSequenceDisplay([8, 6], [0, 2], 0), null);
  assert.equal(getNightSequenceDisplay([8, 6], [0, 2], 1), null);
});

test("work departure filter keeps shift starts and excludes rest and absence", () => {
  const day = [8, 2, 2, 0];
  const night = [0, 2, 5, 0];
  const leave = [null, null, null, "vac_paid"];
  assert.equal(isWorkDepartureDay(day, night, leave, 0), true);
  assert.equal(isWorkDepartureDay(day, night, leave, 1), true);
  assert.equal(isWorkDepartureDay(day, night, leave, 2), false);
  assert.equal(isWorkDepartureDay(day, night, leave, 3), false);
});
