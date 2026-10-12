import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("leader user management enforces scope, field whitelist and position lock in PostgreSQL", { skip: !process.env.PGLITE_MODULE }, async () => {
  const { PGlite } = await import(process.env.PGLITE_MODULE);
  const db = new PGlite();
  const leader = "00000000-0000-0000-0000-000000000001";
  const employee = "00000000-0000-0000-0000-000000000002";
  const foreign = "00000000-0000-0000-0000-000000000003";
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table profiles(user_id uuid primary key, display_name text, position text,
        tab_number text, branch text, employment_date date, weekly_hours numeric, oklad numeric,
        role text default 'user', money_pin_hash text default 'private');
      create function public.is_owner() returns boolean language sql stable security definer as $$
        select exists(select 1 from public.profiles where user_id=auth.uid() and role='owner') $$;
      create table departments(key text primary key,name text);
      create table department_members(department_key text,user_id uuid);
      create table department_editors(department_key text,user_id uuid,is_leader boolean default false,
        is_manual_editor boolean default true, primary key(department_key,user_id));
      create table user_profile_restrictions(user_id uuid primary key,position_locked boolean);
      create table user_schedule_constraints(user_id uuid primary key,no_night_shifts boolean,updated_at timestamptz,updated_by uuid);
      create table owner_audit_log(actor_user_id uuid,target_user_id uuid,action text,details jsonb);
      create table timesheets(user_id uuid,year integer,month integer,payload jsonb);
      insert into profiles(user_id,display_name,position) values
        ('${leader}','Leader','egais_head'),('${employee}','Employee','egais_operator'),('${foreign}','Foreign','loader');
      insert into departments values ('egais','ЕГАИС'),('foreign','Другой отдел');
      insert into department_members values ('egais','${leader}'),('egais','${employee}'),('foreign','${foreign}');
      insert into department_editors values ('egais','${leader}',true,true);
      insert into timesheets values ('${employee}',2026,9,'{"dayHours":[11],"nightHours":[0],"leaveType":[],"moneySnapshot":{"oklad":90000}}');
    `);
    const sql = await readFile(new URL("../supabase-sql/071_department_leader_users.sql", import.meta.url), "utf8");
    await db.exec(sql); await db.exec(sql);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${leader}',false);`);
    const data = (await db.query("select leader_list_department_users() as data")).rows[0].data;
    assert.equal(data.department_key,"egais");
    assert.equal(data.users.length,2);
    assert.ok(data.users.every((row) => !Object.hasOwn(row,"role") && !Object.hasOwn(row,"money_pin_hash")));
    await assert.rejects(db.query("select _leader_users_department()"),/permission denied/);
    await assert.rejects(db.query(`select leader_update_department_user('${foreign}','{"oklad":100}')`),/USER_NOT_IN_DEPARTMENT/);
    await assert.rejects(db.query(`select leader_update_department_user('${employee}','{"role":"owner"}')`),/INVALID_PROFILE_FIELDS/);
    await assert.rejects(db.query(`select leader_update_department_user('${employee}','{"weekly_hours":36}')`),/INVALID_WEEKLY_HOURS/);
    await assert.rejects(db.query(`select leader_update_department_user('${employee}','{"oklad":-1}')`),/INVALID_OKLAD/);
    await db.query(`select leader_update_department_user('${employee}','{"oklad":50000,"weekly_hours":35,"branch":"contract_odyssey"}')`);
    await db.query(`select leader_set_department_user_flag('${employee}','editor',true)`);
    await db.query(`select leader_set_department_user_flag('${employee}','no_night_shifts',true)`);
    await assert.rejects(db.query(`select leader_set_department_user_flag('${employee}','is_leader',true)`),/INVALID_USER_FLAG/);
    await assert.rejects(db.query(`select leader_set_department_user_flag('${foreign}','editor',true)`),/USER_NOT_IN_DEPARTMENT/);
    await db.query(`select leader_set_department_user_flag('${leader}','editor',false)`);
    const sheet = (await db.query(`select leader_get_user_timesheet('${employee}',2026,9) as data`)).rows[0].data;
    assert.deepEqual(Object.keys(sheet).sort(),["dayHours","leaveType","nightHours"]);
    await assert.rejects(db.query(`select leader_get_user_timesheet('${foreign}',2026,9)`),/USER_NOT_IN_DEPARTMENT/);
    await db.exec(`reset role; insert into user_profile_restrictions values ('${employee}',true); set role authenticated;`);
    await assert.rejects(db.query(`select leader_update_department_user('${employee}','{"position":"director"}')`),/POSITION_CHANGE_LOCKED/);
    await db.query(`select leader_update_department_user('${employee}','{"tab_number":"123"}')`);
    await db.exec(`select set_config('request.jwt.claim.sub','${employee}',false);`);
    await assert.rejects(db.query("select leader_list_department_users()"),/ACCESS_DENIED/);
    await db.exec('reset role;');
    const ownerAccess = await readFile(new URL("../supabase-sql/072_owner_department_users_access.sql", import.meta.url), "utf8");
    await db.exec(ownerAccess); await db.exec(ownerAccess);
    await db.exec(`update profiles set role='owner' where user_id='${leader}'; set role authenticated;
      select set_config('request.jwt.claim.sub','${leader}',false);`);
    assert.equal((await db.query("select leader_list_department_users() as data")).rows[0].data.department_key,'egais');
    await db.query(`select leader_update_department_user('${employee}','{"tab_number":"456"}')`);
    await db.exec(`select set_config('request.jwt.claim.sub','${employee}',false);`);
    await assert.rejects(db.query("select leader_list_department_users()"),/ACCESS_DENIED/);
    await assert.rejects(db.query(`select leader_update_department_user('${employee}','{"oklad":1}')`),/ACCESS_DENIED/);
    await db.exec(`reset role;`);
    assert.equal((await db.query(`select is_leader from department_editors where user_id='${employee}'`)).rows[0].is_leader,false);
    assert.equal((await db.query(`select is_leader from department_editors where user_id='${leader}'`)).rows[0].is_leader,true);
    assert.equal((await db.query(`select role from profiles where user_id='${employee}'`)).rows[0].role,'user');
    assert.ok((await db.query("select count(*)::int as count from owner_audit_log")).rows[0].count >= 5);
    await db.exec(`update profiles set role='user' where user_id='${leader}';
      update department_editors set is_leader=false where user_id='${leader}'; set role authenticated;
      select set_config('request.jwt.claim.sub','${leader}',false);`);
    await assert.rejects(db.query("select leader_list_department_users()"),/ACCESS_DENIED/);
  } finally { await db.close(); }
});
