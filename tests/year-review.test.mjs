import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getYearReviewAvailability } from "../js/yearReviewAvailability.js";
import { buildYearReview } from "../js/yearReviewStats.js";

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("year review is visible only from December 25 through January 3", () => {
  assert.equal(getYearReviewAvailability(new Date(2026, 8, 24)).visible, false);
  assert.deepEqual(getYearReviewAvailability(new Date(2026, 11, 25)), { visible:true, year:2026, preview:false });
  assert.deepEqual(getYearReviewAvailability(new Date(2027, 0, 3)), { visible:true, year:2026, preview:false });
  assert.equal(getYearReviewAvailability(new Date(2027, 0, 4)).visible, false);
  assert.deepEqual(getYearReviewAvailability(new Date(2026, 8, 24), true), { visible:true, year:2026, preview:true });
});

test("year review calculates shifts, split nights, absences and payments", () => {
  const payload = {
    dayHours: [11, 2, 2, 0, 8],
    nightHours: [0, 2, 5, 0, 0],
    leaveType: [null, null, null, "vac_paid", null],
    isHoliday: [false, true, false, false, false],
    paySummary: {
      actual: { confirmedAt:"2026-02-10T00:00:00Z", net:50000, paidLeaveNet:5000 },
    },
  };
  const summary = buildYearReview([{ year:2026, month:0, payload }], 2026);
  assert.equal(summary.totalHours, 30);
  assert.equal(summary.shifts, 3);
  assert.equal(summary.nightShifts, 1);
  assert.equal(summary.nightHours, 7);
  assert.equal(summary.holidayHours, 4);
  assert.equal(summary.vacationDays, 1);
  assert.equal(summary.savedPayments, 55000);
  assert.equal(summary.busiestMonth.name, "Январь");
});

test("home exposes animated review only through authenticated dashboard logic", async () => {
  const [home, dashboard, page] = await Promise.all([
    read("index.html"), read("js/homeDashboard.js"), read("year-review.html"),
  ]);
  assert.match(home, /id="yearReviewLink"[^>]*hidden/);
  assert.match(home, /Мой рабочий год/);
  assert.match(home, /year-review-pulse/);
  assert.match(dashboard, /const session = await getSession\(\);[\s\S]*if \(!session\) return;[\s\S]*getYearReviewAvailability/);
  assert.match(page, /class="scene"/);
  assert.match(page, /id="storyProgress"/);
});

test("year review uses one eased scene transition for wheel, keys and touch", async () => {
  const [page, script] = await Promise.all([
    read("year-review.html"), read("js/yearReview.js"),
  ]);
  assert.match(page, /\.story\.is-animating\s*\{\s*scroll-snap-type:none/);
  assert.match(script, /function easeInOutSine/);
  assert.match(script, /Math\.max\(1050,[\s\S]*Math\.abs\(distance\) \* 1\.02/);
  assert.match(script, /transitionLockedUntil = performance\.now\(\) \+ 240/);
  assert.match(script, /requestAnimationFrame\(step\)/);
  assert.match(script, /addEventListener\("wheel"[\s\S]*passive:false/);
  assert.match(script, /addEventListener\("touchend"/);
  assert.doesNotMatch(script, /scrollIntoView\(\{ behavior:"smooth"/);
});
