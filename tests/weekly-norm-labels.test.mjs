import assert from "node:assert/strict";
import test from "node:test";
import { getWeeklyHoursByProfile, getBaseDayHoursByProfile, normalizeNormSnapshot } from "../js/features/timesheetValues.js";

test("female Chateau norm is 36 hours; explicit 35 remains the higher priority reduction", () => {
  const female = { gender: "female", branch: "chateau_alvisa", weekly_hours: 40 };
  assert.equal(getWeeklyHoursByProfile(female), 36);
  assert.equal(getBaseDayHoursByProfile(female), 7.2);
  assert.equal(getWeeklyHoursByProfile({ ...female, weekly_hours: 35 }), 35);
  assert.equal(getBaseDayHoursByProfile({ ...female, weekly_hours: 35 }), 7);
  assert.equal(getWeeklyHoursByProfile({ ...female, gender: "male" }), 40);
  assert.equal(getWeeklyHoursByProfile({ ...female, branch: "alvisa_beverage" }), 40);
  assert.equal(normalizeNormSnapshot({ baseDayHours: 7.2, weeklyHours: 36 }).weeklyHours, 36);
});
