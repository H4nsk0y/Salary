import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";
import { safeAvatarUrl } from "../js/features/safeAvatarUrl.js";
import { SUPABASE_URL } from "../js/config.js";

const uid = "00000000-0000-0000-0000-000000000001";
const other = "00000000-0000-0000-0000-000000000002";
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("owner avatars accept only the employee's project storage folder", () => {
  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/avatars/${uid}/avatar.webp`;
  assert.equal(safeAvatarUrl(publicUrl, uid), publicUrl);
  assert.equal(safeAvatarUrl(`${uid}/avatar.webp`, uid), publicUrl);
  assert.equal(safeAvatarUrl(publicUrl.replace("/public/", "/sign/") + "?token=example", uid), publicUrl.replace("/public/", "/sign/") + "?token=example");
  for (const invalid of ["javascript:alert(1)", "data:image/svg+xml,<svg/>",
    publicUrl.replace(SUPABASE_URL, "https://attacker.example"),
    publicUrl.replace(uid, other), publicUrl.replace("avatar.webp", "%252e%252e/secret"),
    publicUrl.replace("avatar.webp", "../secret"), publicUrl.replace("https://", "https://user:password@")]) {
    assert.equal(safeAvatarUrl(invalid, uid), "");
  }
});

test("login alerts use a server Auth insert, not a bypassable client callback", async () => {
  const sql = await read("supabase-sql/067_owner_login_notifications.sql");
  const push = await read("supabase/functions/send-push-notifications/index.ts");
  assert.match(sql, /after insert on auth\.sessions/i);
  assert.doesNotMatch(sql, /after update on auth\.sessions/i);
  assert.match(sql, /role = 'owner'/);
  assert.match(sql, /OWNER_LOGIN_NOTIFICATION_FAILED/);
  assert.match(push, /isInactiveUsersReport \|\| isOwnerLogin/);
  assert.match(push, /: isOwnerLogin\s*\? await verifyOwnerAccess/);
  assert.doesNotMatch(sql, /access_token|refresh_token|session_id/);
});

test("owner access migrations reject escalation and preserve profile upserts", async () => {
  const sql = await read("supabase-sql/066_owner_access_hardening.sql");
  assert.match(sql, /PROFILE_ROLE_DENIED/);
  assert.match(sql, /PROFILE_USER_ID_IMMUTABLE/);
  assert.match(sql, /grant update \(\s*user_id/);
  assert.match(sql, /as restrictive for select/i);
  assert.match(sql, /revoke all on function %s from authenticated/i);
  assert.match(sql, /REVIEW_OWNER_FUNCTION/);
});

test("push handler rejects non-owners and forged cron secrets, accepting owner or trusted cron", async () => {
  const source = (await read("supabase/functions/send-push-notifications/index.ts"))
    .replace(/^import .*;\r?\n/gm, "");
  let handler;
  const filters = [];
  const query = {
    select() { return this; }, eq(...args) { filters.push(args); return this; },
    is() { return this; }, gt() { return this; }, gte() { return this; }, order() { return this; },
    limit() { return Promise.resolve({ data: [], error: null }); },
  };
  const context = vm.createContext({
    Response, TextEncoder, console,
    serve: (callback) => { handler = callback; },
    Deno: { env: { get: (key) => key === "CRON_SECRET" ? "test-cron-value" : "test-env-value" } },
    webpush: { setVapidDetails() {} },
    createClient: (_url, _key, options) => ({
      rpc: async () => ({ data: options?.global?.headers?.Authorization === "Bearer owner", error: null }),
      from: () => query,
    }),
  });
  vm.runInContext(stripTypeScriptTypes(source), context);
  const request = (authorization, secret = "") => new Request("https://example.test/push", {
    method: "POST", headers: { authorization, "x-cron-secret": secret, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "owner_login", allUsers: false, departmentKey: "test" }),
  });
  assert.equal((await handler(request("Bearer user"))).status, 403);
  assert.equal((await handler(request("Bearer user", "wrong-secret"))).status, 403);
  assert.equal((await handler(request("Bearer owner"))).status, 200);
  assert.equal((await handler(request("Bearer anon", "test-cron-value"))).status, 200);
  assert.ok(filters.some(([key, value]) => key === "type" && value === "owner_login"));
  assert.ok(!filters.some(([key]) => key === "department_key"));
});

// Set PGLITE_MODULE to a locally installed PGlite module for real Postgres checks.
test("database denies cross-user access and role spoofing; Auth alerts cannot block login", {
  skip: !process.env.PGLITE_MODULE,
}, async () => {
  const { PGlite } = await import(process.env.PGLITE_MODULE);
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; grant usage on schema auth to authenticated;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create function auth.role() returns text language sql stable as $$
        select nullif(current_setting('request.jwt.claim.role', true), '') $$;
      create table public.profiles (user_id uuid primary key, role text default 'user',
        created_at timestamptz default now(), oklad numeric, gender text, position text, display_name text,
        avatar_url text, hide_money boolean, money_pin_hash text, money_pin_salt text,
        auto_collapse_table_panels boolean, tab_number text, branch text, employment_date date,
        weekly_hours numeric, egais_file_reminders_enabled boolean, hide_calculator_nav boolean);
      create function public.is_owner() returns boolean language sql stable security definer
      set search_path = public as $$ select exists (select 1 from public.profiles where user_id = auth.uid() and role = 'owner') $$;
      create function public.owner_probe() returns text language plpgsql security definer
      set search_path = public as $$ begin if not public.is_owner() then raise exception 'ACCESS_DENIED'; end if; return 'ok'; end $$;
      create function public._owner_probe() returns text language sql security definer as $$ select 'internal'::text $$;
      grant execute on function public.owner_probe() to authenticated;
      create table public.department_members (department_key text, user_id uuid, sort_order integer, created_at timestamptz default now());
      create table public.department_editors (department_key text, user_id uuid, created_at timestamptz default now(), primary key (department_key, user_id));
      grant all on public.department_editors to authenticated;
      create table public.departments (key text primary key, name text);
      insert into departments values ('test', 'Test'), ('foreign', 'Foreign');
      create table public.department_invites (token text primary key, department_key text,
        created_by uuid, created_at timestamptz default now(), expires_at timestamptz,
        max_uses integer, used_count integer default 0, revoked_at timestamptz);
      insert into department_invites (token, department_key) values ('own-token', 'test'), ('foreign-token', 'foreign');
      create schema extensions;
      create function extensions.gen_random_bytes(amount integer) returns bytea language sql
      as $$ select decode(repeat('ab', amount), 'hex') $$;
      create function public.can_edit_department(dept text) returns boolean language sql stable security definer
      as $$ select public.is_owner() or (auth.uid() = '${uid}'::uuid and dept = 'test') $$;
      insert into department_members (department_key, user_id) values ('test', '${uid}'), ('test', '${other}');
      grant all on profiles to authenticated;
      create policy legacy_wide_access on profiles for all to authenticated using (true) with check (true);
      create table auth.sessions (id uuid primary key, user_id uuid, user_agent text, ip inet);
      create table public.owner_audit_log (actor_user_id uuid, target_user_id uuid, action text, details jsonb);
      create table public.user_notifications (user_id uuid, actor_user_id uuid, type text, title text,
        body text, url text, expires_at timestamptz);
      insert into profiles (user_id, role) values ('${uid}', 'user'), ('${other}', 'owner');
    `);
    // Exercise the real legacy definitions, not only simplified owner fixtures.
    for (const [file, name] of [
      ['006_fix_invite_permissions_and_pgcrypto.sql', 'owner_create_department_invite'],
      ['006_fix_invite_permissions_and_pgcrypto.sql', 'owner_revoke_department_invite'],
      ['015_delete_department_invites.sql', 'owner_delete_department_invite'],
      ['022_department_member_order.sql', 'owner_list_department_members'],
      ['042_department_member_management.sql', 'remove_managed_department_member'],
    ]) {
      const sql = await read(`supabase-sql/${file}`);
      const start = sql.indexOf(`create or replace function public.${name}(`);
      assert.ok(start >= 0);
      const end = sql.indexOf('$$;', sql.indexOf('as $$', start));
      await db.exec(sql.slice(start, end + 3));
    }
    await db.exec(`grant execute on function public.owner_create_department_invite(text, integer, integer),
      public.owner_revoke_department_invite(text), public.owner_delete_department_invite(text),
      public.owner_list_department_members(text) to authenticated;`);
    await db.exec(await read('tests/fixtures/legacy-owner-rpcs.sql'));
    const harden = await read("supabase-sql/066_owner_access_hardening.sql");
    const alerts = await read("supabase-sql/067_owner_login_notifications.sql");
    await db.exec(harden);
    await db.exec(harden);
    await db.exec(alerts);
    await db.exec(alerts);
    const reports = await db.exec(await read("supabase-sql/068_owner_security_report.sql"));
    const verdict = reports.at(-1).rows[0];
    for (const [key, value] of Object.entries(verdict)) {
      if (Array.isArray(value)) assert.deepEqual(value, [], key);
      else assert.equal(value, true, key);
    }
    assert.equal((await db.exec(await read('supabase-sql/069_owner_rpc_preflight.sql')))[0].rows.length, 0);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);
      select set_config('request.jwt.claim.role', 'authenticated', false);`);
    assert.equal((await db.query("select * from profiles")).rows.length, 1);
    const team = (await db.query("select * from list_managed_department_members('test')")).rows;
    assert.equal(team.length, 2);
    assert.ok(!Object.hasOwn(team[0], 'money_pin_hash'));
    await assert.rejects(db.exec("select * from list_managed_department_members('foreign')"), /ACCESS_DENIED/);
    assert.equal((await db.query("select * from owner_list_department_members('test')")).rows.length, 2);
    await db.query("select * from owner_list_available_profiles('test')");
    await db.query("select * from owner_list_department_editors('test')");
    await assert.rejects(db.exec("select * from owner_list_available_profiles('foreign')"), /ACCESS_DENIED/);
    await assert.rejects(db.exec("select * from owner_list_department_editors('foreign')"), /ACCESS_DENIED/);
    await assert.rejects(db.exec(`select owner_add_department_editor('test', '${uid}')`), /ACCESS_DENIED/);
    await assert.rejects(db.exec(`select owner_remove_department_editor('test', '${uid}')`), /ACCESS_DENIED/);
    await assert.rejects(db.exec(`insert into department_editors (department_key, user_id) values ('test', '${uid}')`), /permission denied/);
    await assert.rejects(db.exec(`select owner_add_department_member('foreign', '${uid}')`), /ACCESS_DENIED/);
    await assert.rejects(db.exec(`select owner_remove_department_member('foreign', '${uid}')`), /ACCESS_DENIED/);
    await assert.rejects(db.exec(`select owner_remove_department_member('test', '${other}')`), /PROTECTED_MEMBER/);
    await assert.rejects(db.exec(`select owner_remove_department_member('test', '${uid}')`), /CANNOT_REMOVE_SELF/);
    await db.exec(`select owner_add_department_member('test', '${uid}')`);
    await assert.rejects(db.exec("select * from owner_list_department_members('foreign')"), /ACCESS_DENIED/);
    await assert.rejects(db.exec("select * from owner_create_department_invite('foreign', 14, null)"), /ACCESS_DENIED/);
    assert.equal((await db.query("select * from owner_create_department_invite('test', 14, null)")).rows.length, 1);
    await assert.rejects(db.exec("select owner_revoke_department_invite('foreign-token')"), /ACCESS_DENIED/);
    await assert.rejects(db.exec("select owner_delete_department_invite('foreign-token')"), /ACCESS_DENIED/);
    await db.exec("select owner_revoke_department_invite('own-token'); select owner_delete_department_invite('own-token');");
    await assert.rejects(db.exec("select public.owner_probe()"), /ACCESS_DENIED/);
    await assert.rejects(db.exec("select public._owner_probe()"), /permission denied/);
    await assert.rejects(db.exec("update profiles set role = 'owner'"), /permission denied/);
    await db.exec(`insert into profiles (user_id, display_name) values ('${uid}', '<img onerror=alert(1)>')
      on conflict (user_id) do update set user_id = excluded.user_id, display_name = excluded.display_name;`);
    await assert.rejects(db.exec(`update profiles set user_id = '${other}'`), /PROFILE_USER_ID_IMMUTABLE/);
    await assert.rejects(db.exec(`update profiles set avatar_url = 'https://attacker.example/avatars/${uid}/a.png'`), /INVALID_AVATAR_ORIGIN/);
    await db.exec(`update profiles set avatar_url = '${uid}/a.png'`);
    // Even an accidental future column grant cannot bypass the trigger.
    await db.exec("reset role; grant update (role) on profiles to authenticated; set role authenticated;");
    await assert.rejects(db.exec("update profiles set role = 'owner'"), /PROFILE_ROLE_DENIED/);
    await db.exec(`select set_config('request.jwt.claim.sub', '${other}', false);`);
    assert.equal((await db.query("select public.owner_probe() as result")).rows[0].result, "ok");
    await db.exec(`select owner_add_department_editor('test', '${uid}'); select owner_remove_department_editor('test', '${uid}');`);
    assert.equal((await db.query("select * from profiles")).rows.length, 2);
    await db.exec(`insert into profiles (user_id, display_name) values ('${other}', 'Owner')
      on conflict (user_id) do update set user_id = excluded.user_id, display_name = excluded.display_name;`);
    assert.equal((await db.query(`select role from profiles where user_id = '${other}'`)).rows[0].role, 'owner');
    await assert.rejects(db.exec(`update profiles set role = 'owner' where user_id = '${uid}'`), /PROFILE_ROLE_DENIED/);
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', '', false);");
    await db.exec(`insert into auth.sessions values ('${uid}', '${uid}', 'Chrome/120 Windows', '127.0.0.1');`);
    assert.equal((await db.query("select * from user_notifications")).rows.length, 0);
    await db.exec(`insert into auth.sessions values ('${other}', '${other}', 'Chrome/120 Windows', '127.0.0.1');`);
    const notification = (await db.query("select * from user_notifications")).rows[0];
    assert.equal(notification.user_id, other);
    assert.match(notification.body, /Windows, Chrome/);
    await db.exec(`update auth.sessions set user_agent = 'Safari' where id = '${other}'`);
    assert.equal((await db.query("select * from user_notifications")).rows.length, 1);
    await db.exec("drop table user_notifications;");
    await db.exec(`insert into auth.sessions values ('00000000-0000-0000-0000-000000000003', '${other}', '', null);`);
    assert.equal((await db.query("select * from auth.sessions")).rows.length, 3);
  } finally {
    await db.close();
  }
});
