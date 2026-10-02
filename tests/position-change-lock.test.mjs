import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("owner can lock a user's position from the users center", async () => {
  const [users, db] = await Promise.all([
    read("js/owner-users.js"),
    read("js/db.js"),
  ]);

  assert.match(users, /Запретить менять должность/);
  assert.match(users, /Разрешить менять должность/);
  assert.match(users, /Должность закреплена/);
  assert.match(users, /ownerSetUserPositionLock/);
  assert.match(db, /owner_set_user_position_lock/);
  assert.match(db, /owner_list_user_position_locks/);
});

test("profile disables a locked position and explains why", async () => {
  const [html, profile] = await Promise.all([
    read("profile.html"),
    read("js/profile.js"),
  ]);

  assert.match(html, /id="positionLockHint"/);
  assert.match(profile, /effectiveProfile\.position_locked === true/);
  assert.match(profile, /positionSelect\.disabled = positionLocked/);
  assert.match(profile, /POSITION_CHANGE_LOCKED/);
});

test("database rejects direct position changes while preserving owner control", async () => {
  const sql = await read("supabase-sql/065_position_change_locks.sql");

  assert.match(sql, /revoke all on table public\.user_profile_restrictions from public, anon, authenticated/i);
  assert.match(sql, /before update of position on public\.profiles/i);
  assert.match(sql, /new\.position is distinct from old\.position/i);
  assert.match(sql, /raise exception 'POSITION_CHANGE_LOCKED'/i);
  assert.match(sql, /and auth\.uid\(\) is not null\s+and not public\.is_owner\(\)/i);
  assert.match(sql, /'position_locked', exists/i);
});
