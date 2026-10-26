import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { computeSalary, computePaymentSplit, normalizeTaxRate, TAX_RATE } from "../js/calc.js";
import { explainPayment } from "../js/features/paymentExplanations.js";

const input = { oklad: 50000, normHours: 160, workedHours: 168, nightHours: 40 };
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("tax defaults to 13% without turning zero into the default", () => {
  assert.equal(normalizeTaxRate(undefined), .13);
  assert.equal(normalizeTaxRate(null), .13);
  assert.equal(normalizeTaxRate(0), 0);
  assert.equal(normalizeTaxRate("0"), 0);
  assert.equal(normalizeTaxRate("0.055"), .055);
  assert.deepEqual(computeSalary(input), computeSalary({ ...input, taxRate: .13 }));
});

test("all salary components and the advance use the selected tax", () => {
  for (const taxRate of [0, .055, .13, .15, 1]) {
    const { result } = computeSalary({ ...input, taxRate });
    const holidayGross = 312.5 * 1.35 * 11 + 312.5 * .4 * 7;
    const net = result.net + holidayGross * (1-taxRate);
    assert.ok(Math.abs(result.tax - result.gross * taxRate) < 1e-8);
    assert.ok(Math.abs(result.hourRate - 50000 * 1.35 * (1-taxRate) / 160) < 1e-8);
    const split = computePaymentSplit({ netTotal: net, effectiveOklad: 50000, monthNorm: 160,
      firstHalfDayHours: 60, firstHalfNightHours: 20, taxRate });
    assert.ok(Math.abs(split.advance - (312.5*80 + 312.5*.4*20)*(1-taxRate)) < 1e-8);
    assert.ok(Math.abs(split.advance + split.remaining - net) < 1e-8);
    if (taxRate === 0) assert.equal(result.net, result.gross);
    if (taxRate === 1) assert.equal(result.net, 0);
  }
  for (const taxRate of [-1, 1.1, NaN, Infinity, "0"]) assert.equal(computeSalary({ ...input, taxRate }).ok, false);
});

test("tax explanations and stored summaries preserve 0%", async () => {
  const c = { taxRate: 0, gross: 10000, tax: 0, effectiveOkladSnapshot: 50000, monthNorm:160, baseFactGross:10000 };
  assert.match(explainPayment("taxPay", { calculated: c }).detail, /× 0% = 0/);
  assert.match(explainPayment("baseFactGross", { calculated: c }).message, /0% налога/);
  for (const file of ["js/table.js", "js/profile.js"]) {
    const source = await read(file);
    const start = source.indexOf("function cloneCalculatedSummary(calculated)");
    const end = source.indexOf("\n}", start)+2;
    const context = vm.createContext({ normalizeTaxRate, normalizeMoneyNumber: (v) => v ?? null });
    vm.runInContext(source.slice(start, end), context);
    assert.equal(context.cloneCalculatedSummary({ taxRate:0 }).taxRate,0);
    assert.equal(context.cloneCalculatedSummary({}).taxRate,TAX_RATE);
  }
});

test("tax field migration is idempotent and retains profile isolation", { skip: !process.env.PGLITE_MODULE }, async () => {
  const { PGlite } = await import(process.env.PGLITE_MODULE);
  const db = new PGlite();
  const uid = "00000000-0000-0000-0000-000000000001";
  const other = "00000000-0000-0000-0000-000000000002";
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth; grant usage on schema auth to authenticated;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table profiles(user_id uuid primary key,role text default 'user');
      insert into profiles values ('${uid}','user'),('${other}','owner');
      alter table profiles enable row level security;
      grant select on profiles to authenticated;
      create policy own_profile on profiles for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
      create function public.get_my_app_context() returns jsonb language sql security definer set search_path=public as $$
        select jsonb_build_object('profile',(select jsonb_build_object('user_id',user_id) from profiles where user_id=auth.uid()),'membership_department_key','egais') $$;`);
    const sql = await read("supabase-sql/073_profile_tax_rate.sql");
    await db.exec(sql); await db.exec(sql);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`);
    assert.equal((await db.query("select get_my_app_context() as data")).rows[0].data.profile.tax_rate,.13);
    await db.query("update profiles set tax_rate=0");
    const context = (await db.query("select get_my_app_context() as data")).rows[0].data;
    assert.equal(context.profile.tax_rate,0);
    assert.equal(context.membership_department_key,'egais');
    await assert.rejects(db.query("update profiles set role='owner'"),/permission denied/);
    await assert.rejects(db.query("update profiles set tax_rate=1.1"),/constraint/);
    await assert.rejects(db.query("select _get_my_app_context_before_tax()"),/permission denied/);
    await db.exec("reset role;");
    assert.equal((await db.query(`select tax_rate from profiles where user_id='${other}'`)).rows[0].tax_rate,"0.130000");
    await db.exec("set role anon;");
    await assert.rejects(db.query("select get_my_app_context()"),/permission denied/);
  } finally { await db.close(); }
});
