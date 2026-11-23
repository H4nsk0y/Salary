import assert from 'node:assert/strict';
import test from 'node:test';
import { paymentCountdown } from '../js/features/budgetCountdown.js';

test('countdown targets 13:00 Moscow regardless of the runtime timezone', () => {
  const countdown = paymentCountdown('2026-11-25', Date.parse('2026-11-23T13:00:00+03:00'));
  assert.equal(countdown.target, Date.parse('2026-11-25T10:00:00Z'));
  assert.equal(countdown.text, '(2 д 00:00:00)');
  assert.equal(countdown.elapsed, false);
  assert.equal(paymentCountdown('2026-11-24', Date.parse('2026-11-23T13:00:00+03:00')).text, '(1 д 00:00:00)');
});
test('seconds round upward until the target and stop at zero afterwards', () => {
  assert.equal(paymentCountdown('2026-11-25', Date.parse('2026-11-25T12:59:59.001+03:00')).text, '(00:00:01)');
  for (const time of ['13:00:00','15:00:00']) {
    const countdown = paymentCountdown('2026-11-25', Date.parse(`2026-11-25T${time}+03:00`));
    assert.equal(countdown.text, '(00:00:00)');
    assert.equal(countdown.elapsed, true);
  }
});
test('missing or invalid payment dates do not render a timer', () => {
  for (const date of [null, undefined, '', '2026-02-31', 'not-a-date']) assert.equal(paymentCountdown(date), null);
  assert.equal(paymentCountdown('2026-11-25', NaN), null);
});
