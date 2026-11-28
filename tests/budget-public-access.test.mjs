import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('opening the budget preserves existing records and isolates every account, including owners', { skip: !process.env.PGLITE_MODULE }, async () => {
  const { PGlite } = await import(process.env.PGLITE_MODULE);
  const db = new PGlite();
  const owner = '00000000-0000-0000-0000-000000000001', user = '00000000-0000-0000-0000-000000000002';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; grant usage on schema auth to authenticated; create table auth.users(id uuid primary key);
      insert into auth.users values('${owner}'),('${user}');
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function is_owner() returns boolean language sql stable as $$select auth.uid()='${owner}'::uuid$$;
      create table profiles(user_id uuid primary key,role text); insert into profiles values('${owner}','owner'),('${user}','user');
      create table user_notifications(id bigserial primary key,user_id uuid,type text,title text,body text,url text,expires_at timestamptz);
      create table budget_bill_push_days(user_id uuid, reminder_day date, claimed_at timestamptz,delivered_at timestamptz,notification_id bigint,primary key(user_id,reminder_day));`);
    await db.exec(await read('supabase-sql/077_finance_budget_access.sql'));
    await db.exec(`insert into finance_budgets values('${owner}','{"daily":0,"records":[],"people":3}',8);
      create policy legacy_allow on finance_budgets for all to authenticated using(true) with check(true);`);
    const sql = await read('supabase-sql/083_budget_all_users.sql');
    await db.exec(sql); await db.exec(sql);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);`);
    assert.equal((await db.query('select * from finance_budgets')).rows.length, 0);
    await db.exec(`insert into finance_budgets values('${user}','{"daily":100,"records":[]}',0)`);
    assert.equal((await db.query('update finance_budgets set revision=1 where revision=0 returning user_id')).rows[0].user_id, user);
    assert.equal((await db.query('update finance_budgets set revision=1 where revision=0 returning user_id')).rows.length, 0);
    await assert.rejects(db.exec(`update finance_budgets set user_id='${owner}'`), /row-level security/);
    await assert.rejects(db.exec(`select * from claim_budget_bill_reminder('${owner}')`), /permission denied/);
    await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false);`);
    assert.deepEqual((await db.query('select revision,state from finance_budgets')).rows, [{ revision: 8, state: { daily: 0, records: [], people: 3 } }]);
    await assert.rejects(db.exec('delete from finance_budgets'), /permission denied/);
    await db.exec("select set_config('request.jwt.claim.sub','',false);");
    assert.equal((await db.query('select * from finance_budgets')).rows.length, 0);
    await db.exec('reset role; set role service_role;');
    const claim = (await db.query(`select * from claim_budget_bill_reminder('${user}')`)).rows[0];
    assert.ok(claim.notification_id);
    assert.equal((await db.query(`select * from claim_budget_bill_reminder('${user}')`)).rows.length, 0);
    await db.exec('reset role; set role anon;');
    await assert.rejects(db.exec('select * from finance_budgets'), /permission denied/);
  } finally { await db.close(); }
});

test('background workers page through actual budgets without owner-only recipient filters', async () => {
  for (const file of ['credit-budget-salary', 'send-budget-reminders']) {
    const source = await read(`supabase/functions/${file}/index.ts`);
    assert.match(source, /from\('finance_budgets'\)/);
    assert.match(source, /range\(offset, offset \+ 199\)/);
    assert.doesNotMatch(source, /eq\("role", "owner"\)/);
  }
});
