import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { formatEmploymentDateInput, normalizeEmploymentDateInput } from "../js/features/employmentDateCalendar.js";

test("employment date input round-trips valid local dates and rejects invalid dates", () => {
  assert.equal(formatEmploymentDateInput("2024-02-29"), "29.02.2024");
  assert.equal(normalizeEmploymentDateInput("29.02.2024"), "2024-02-29");
  assert.equal(normalizeEmploymentDateInput("29022024"), "2024-02-29");
  assert.equal(normalizeEmploymentDateInput("29.02.2025"), "");
  assert.equal(normalizeEmploymentDateInput("31.04.2026"), "");
});

test("position catalog is enforced by Postgres for employee, leader and owner flows", { skip: !process.env.PGLITE_MODULE }, async () => {
  const { PGlite } = await import(process.env.PGLITE_MODULE);
  const db = new PGlite();
  const id = (number) => `00000000-0000-0000-0000-00000000000${number}`;
  const [owner, locked, leader, employee, other, legacy] = [1, 2, 3, 4, 5, 6].map(id);
  const role = async (user) => {
    await db.exec("reset role; set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  };
  const select = async (sql, params = []) => (await db.query(sql, params)).rows[0]?.data;
  const choices = (user = null) => select("select get_profile_position_options($1) as data", [user]);
  const propose = (department, name) => select("select submit_department_position_proposal($1,$2) as data", [department, name]);
  try {
    await db.exec(`
      create role anon; create role authenticated; create schema auth;
      grant usage on schema auth to authenticated, anon;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.role() returns text language sql stable as $$
        select case when auth.uid() is not null then 'authenticated' end $$;
      create table auth.users(id uuid primary key, email text);
      create table profiles(user_id uuid primary key references auth.users(id), role text default 'user',
        position text, display_name text, gender text, oklad numeric, tab_number text,
        branch text, employment_date date, weekly_hours numeric);
      create table departments(key text primary key, name text);
      create table department_members(department_key text, user_id uuid, created_at timestamptz default now());
      create table department_editors(department_key text, user_id uuid, is_leader boolean, is_manual_editor boolean,
        primary key(department_key,user_id));
      create table user_notifications(user_id uuid, actor_user_id uuid, type text, title text, body text, url text, expires_at timestamptz);
      create table owner_audit_log(actor_user_id uuid, target_user_id uuid, action text, details jsonb);
      create function is_owner() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
        select role='owner' from profiles where user_id=auth.uid() $$;
      alter table profiles enable row level security;
      grant select on profiles to authenticated;
      grant insert(user_id,position,display_name),update(position,display_name) on profiles to authenticated;
      create policy own_profile on profiles for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
      insert into departments values ('egais','Отдел ЕГАИС'),('warehouse','Склад ГП');
      insert into auth.users(id) values ('${owner}'),('${locked}'),('${leader}'),('${employee}'),('${other}'),('${legacy}');
      insert into profiles(user_id,role,position) values ('${owner}','owner',null),
        ('${locked}','user','egais_operator'),('${leader}','user','egais_head'),('${employee}','user','egais_operator'),
        ('${other}','user','loader'),('${legacy}','user','Существующая должность');
      insert into department_members(department_key,user_id) values ('egais','${locked}'),('egais','${leader}'),
        ('egais','${employee}'),('warehouse','${other}'),('egais','${legacy}'),('egais','${owner}');
      insert into department_editors values ('egais','${leader}',true,false);
    `);
    for (const file of [
      "033_project_ideas.sql", "038_idea_review_notifications.sql", "051_owner_idea_notifications.sql",
      "065_position_change_locks.sql", "071_department_leader_users.sql",
      "074_department_position_catalog.sql", "074_department_position_catalog.sql",
    ]) await db.exec(await readFile(new URL(`../supabase-sql/${file}`, import.meta.url), "utf8"));

    await role(owner);
    const ownerChoices = await choices();
    assert.deepEqual(ownerChoices.departments.map((d) => d.key).sort(), ["egais", "warehouse"]);
    assert.equal(ownerChoices.positions.some((p) => p.value === "egais_head"), true);
    assert.equal(ownerChoices.positions.some((p) => p.value === "loader"), true);
    await db.query("update profiles set position='egais_head'");
    await db.query("update profiles set position='loader'");
    assert.deepEqual((await choices(employee)).departments.map((d) => d.key), ["egais"]);
    assert.equal((await choices(employee)).positions.some((p) => p.value === "egais_head"), false);
    await db.query("select owner_set_user_position_lock($1,true)", [locked]);
    await role(locked);
    assert.equal((await choices()).locked, true);
    await assert.rejects(db.query("update profiles set position='egais_senior_operator'"), /POSITION_CHANGE_LOCKED/);
    await assert.rejects(db.query("insert into profiles(user_id,position) values ($1,'egais_senior_operator') on conflict (user_id) do update set position=excluded.position", [locked]), /POSITION_CHANGE_LOCKED/);
    await db.query("insert into profiles(user_id,display_name) values ($1,'Сотрудник') on conflict (user_id) do update set display_name=excluded.display_name", [locked]);
    await role(legacy);
    await db.query("insert into profiles(user_id,position) values ($1,'Существующая должность') on conflict (user_id) do update set position=excluded.position", [legacy]);
    assert.equal((await choices()).positions.some((p) => p.value === "Существующая должность"), false);

    await role(employee);
    const own = await choices();
    assert.deepEqual(own.departments.map((d) => d.key), ["egais"]);
    assert.deepEqual(own.positions.map((p) => p.value).sort(), ["egais_operator", "egais_senior_operator"]);
    await assert.rejects(choices(other), /ACCESS_DENIED/);
    await assert.rejects(db.query("update profiles set position='loader'"), /POSITION_NOT_ALLOWED/);
    await assert.rejects(db.query("update profiles set position='egais_head'"), /DEPARTMENT_LEADER_POSITION_RESERVED/);
    await assert.rejects(propose("warehouse", "Инженер"), /POSITION_NOT_ALLOWED/);
    const idea = await propose("egais", "  Инженер   смены ");
    await assert.rejects(propose("egais", "Инженер смены"), /POSITION_PROPOSAL_PENDING/);
    await assert.rejects(db.query("update profiles set position='Инженер смены'"), /POSITION_NOT_ALLOWED/);
    await assert.rejects(db.query("select owner_approve_department_position($1)", [idea]), /ACCESS_DENIED/);
    await assert.rejects(db.query("select * from department_position_catalog"), /permission denied/);
    await assert.rejects(db.query("select _profile_position_department($1)", [other]), /permission denied/);

    await role(leader);
    assert.equal((await choices(employee)).department_key, "egais");
    await assert.rejects(choices(other), /USER_NOT_IN_DEPARTMENT/);
    await assert.rejects(db.query("select leader_update_department_user($1,'{\"position\":\"loader\"}')", [employee]), /POSITION_NOT_ALLOWED/);
    await assert.rejects(db.query("select leader_update_department_user($1,'{\"position\":\"egais_senior_operator\"}')", [locked]), /POSITION_CHANGE_LOCKED/);

    await role(owner);
    const pending = await select("select owner_list_project_ideas_with_positions('new') as data");
    assert.equal(pending.position_proposal.name, "Инженер смены");
    assert.equal(pending.position_proposal.approved, false);
    await db.query("select owner_approve_department_position($1)", [idea]);
    await db.query("select owner_approve_department_position($1)", [idea]);
    assert.equal((await select("select owner_list_project_ideas_with_positions('reviewed') as data")).position_proposal.approved, true);

    await role(employee);
    assert.equal(await select("select position as data from profiles"), "egais_operator");
    assert.equal((await choices()).positions.some((p) => p.value === "Инженер смены"), true);
    await db.query("update profiles set position='Инженер смены'");
    await role(other);
    assert.equal((await choices()).positions.some((p) => p.value === "Инженер смены"), false);
    await db.exec("reset role");
    assert.equal(await select("select count(*)::int as data from owner_audit_log where action='position_changed' and target_user_id=$1", [employee]), 1);
    assert.equal(await select("select count(*)::int as data from user_notifications where type='project_idea_reviewed' and user_id=$1", [employee]), 1);
    await db.exec("set role anon");
    await assert.rejects(db.query("select get_profile_position_options()"), /permission denied/);
  } finally { await db.close(); }
});
