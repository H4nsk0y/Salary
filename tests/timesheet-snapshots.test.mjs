import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTimesheetSnapshot, planSnapshotRestore } from '../js/features/timesheetSnapshots.js';
const state = (id = 'one') => ({ userId: id, name: id, dayHours: Array(31).fill(0), nightHours: Array(31).fill(0),
  leaveType: Array(31).fill(null), shiftComments: Array(31).fill(''), dayInputs: Array.from({ length: 31 }, () => ({ disabled: false })) });
test('snapshot is a detached copy and restoration includes hours, leaves and comments only', () => {
  const original = state(); original.dayHours[0] = 11; original.leaveType[1] = 'vac_paid'; original.shiftComments[1] = 'Отпуск';
  const snapshot = createTimesheetSnapshot([original], 2026, 11);
  original.dayHours[0] = 8;
  const result = planSnapshotRestore(snapshot, [state()], 2026, 11);
  assert.equal(snapshot.people[0].dayHours[0], 11);
  assert.equal(result.count, 2);
  assert.equal(result.plans[0].changes[1].to.leaveType, 'vac_paid');
  assert.equal(result.plans[0].changes[1].to.comment, 'Отпуск');
  assert.deepEqual(Object.keys(snapshot.people[0]).sort(), ['dayHours', 'leaveType', 'name', 'nightHours', 'shiftComments', 'userId']);
});
test('wrong month, corrupt payload and duplicate users fail before mutation', () => {
  const current = state(); const snapshot = createTimesheetSnapshot([current], 2026, 11);
  assert.throws(() => planSnapshotRestore(snapshot, [current], 2026, 10));
  snapshot.people[0].dayHours[0] = 25;
  assert.throws(() => planSnapshotRestore(snapshot, [current], 2026, 11));
  snapshot.people[0].dayHours[0] = 0;
  snapshot.people.push(snapshot.people[0]);
  assert.throws(() => planSnapshotRestore(snapshot, [current], 2026, 11));
  assert.equal(current.dayHours[0], 0);
});
test('missing employees are reported, new people and employment locks remain intact', () => {
  const old = state('removed'); const current = state();
  const snapshot = createTimesheetSnapshot([old, current], 2026, 11);
  snapshot.people[1].dayHours[0] = 11;
  current.dayInputs[0].disabled = true;
  const result = planSnapshotRestore(snapshot, [current, state('new')], 2026, 11);
  assert.deepEqual(result.missing, ['removed']); assert.equal(result.count, 0);
});
test('new night prohibition and changed dismissal boundaries block restoration', () => {
  const current = state(); const snapshot = createTimesheetSnapshot([current], 2026, 11);
  snapshot.people[0].dayHours[0] = 2; snapshot.people[0].nightHours[0] = 2;
  assert.throws(() => planSnapshotRestore(snapshot, [current], 2026, 11, new Set(['one'])), /запрет/);
  snapshot.people[0].dayHours[0] = 0; snapshot.people[0].nightHours[0] = 0; snapshot.people[0].leaveType[0] = 'dismissed';
  assert.throws(() => planSnapshotRestore(snapshot, [current], 2026, 11), /трудоустройства/);
});
test('snapshot SQL enforces editor permissions, fixed Moscow expiry, storage limits and cleanup', () => {
  const sql = readFileSync(new URL('../supabase-sql/082_department_timesheet_snapshots.sql', import.meta.url), 'utf8');
  assert.match(sql, /enable row level security/); assert.match(sql, /can_edit_department\(department_key\)/);
  assert.match(sql, /created_by = auth.uid\(\)/); assert.match(sql, /expires_at > now\(\)/);
  assert.match(sql, /at time zone 'Europe\/Moscow'/); assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /SNAPSHOT_LIMIT_REACHED/); assert.match(sql, /cron.schedule/);
  assert.doesNotMatch(sql, /grant.*\bupdate\b/i);
});
