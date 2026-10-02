import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("startup context is one protected request with a legacy fallback", async () => {
  const [db, sql] = await Promise.all([
    read("js/db.js"),
    read("supabase-sql/064_app_bootstrap_context.sql"),
  ]);

  assert.match(db, /let myAppContextPromise = null/);
  assert.match(db, /supabase\.rpc\("get_my_app_context"\)/);
  assert.match(db, /Promise\.all\(\[\s*loadMyProfile\(\),\s*loadMyDepartmentMembershipKey\(\),\s*loadMyEditorDepartmentKey\(\)/);
  assert.match(db, /getMyAppContext\(\{ fresh \}\)\.then\(\(context\) => context\.profile\)/);
  assert.match(db, /context\.membershipDepartmentKey/);
  assert.match(db, /context\.managedDepartment/);

  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path = public/i);
  assert.match(sql, /if v_user_id is null then\s+raise exception 'NO_SESSION'/i);
  assert.match(sql, /where p\.user_id = v_user_id/i);
  assert.match(sql, /where dm\.user_id = v_user_id/i);
  assert.match(sql, /where de\.user_id = v_user_id/i);
  assert.match(sql, /revoke all on function public\.get_my_app_context\(\) from public, anon/i);
  assert.match(sql, /grant execute on function public\.get_my_app_context\(\) to authenticated/i);
});

test("profile and navigation share the same db module instance", async () => {
  const [profile, nav] = await Promise.all([
    read("js/profile.js"),
    read("js/nav.js"),
  ]);

  assert.match(profile, /from "\.\/db\.js"/);
  assert.doesNotMatch(profile, /from "\.\/db\.js\?v=/);
  assert.match(nav, /from "\.\/db\.js"/);
});
