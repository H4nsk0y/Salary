import test from 'node:test';
import assert from 'node:assert/strict';
import { isFestiveSeason } from '../js/features/festiveBootstrap.js';
import { isFestiveHuntSeason } from '../js/features/festiveHuntModel.js';
test('Santa remains hidden until December 25 and is available through January 3 inclusive', () => {
  assert.equal(isFestiveHuntSeason(Date.parse('2026-11-28T12:00:00+03:00')), false);
  assert.equal(isFestiveHuntSeason(Date.parse('2026-12-24T23:59:59+03:00')), false);
  assert.equal(isFestiveHuntSeason(Date.parse('2026-12-25T00:00:00+03:00')), true);
  assert.equal(isFestiveHuntSeason(Date.parse('2027-01-03T23:59:59+03:00')), true);
  assert.equal(isFestiveHuntSeason(Date.parse('2027-01-04T00:00:00+03:00')), false);
  assert.equal(isFestiveSeason(Date.parse('2027-01-04T12:00:00+03:00')), true);
});
test('public festive event starts November 28 Moscow and stops exactly January 10', () => {
  assert.equal(isFestiveSeason(Date.parse('2026-11-27T23:59:59+03:00')), false);
  assert.equal(isFestiveSeason(Date.parse('2026-11-28T00:00:00+03:00')), true);
  assert.equal(isFestiveSeason(Date.parse('2027-01-09T23:59:59+03:00')), true);
  assert.equal(isFestiveSeason(Date.parse('2027-01-10T00:00:00+03:00')), false);
});
