import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("pages use compiled Tailwind and a baseline content security policy", async () => {
  const files = (await readdir(root)).filter((name) => name.endsWith(".html"));
  const pages = await Promise.all(files.map(async (name) => [name, await source(name)]));

  for (const [name, html] of pages) {
    assert.doesNotMatch(html, /cdn\.tailwindcss\.com/, `${name} still loads Tailwind CDN`);
    assert.match(html, /Content-Security-Policy/, `${name} has no CSP`);
  }
});

test("schedule cache is read-only, scoped and clearly labelled", async () => {
  const [cache, schedule] = await Promise.all([
    source("scheduleCache.js"),
    source("schedule.js"),
  ]);

  assert.match(cache, /snapshot:\$\{userKey\(userId\)\}:\$\{departmentKey\}:\$\{startDate\}/);
  assert.match(cache, /MAX_CACHE_AGE_MS/);
  assert.match(schedule, /Нет доступа к базе, показан последний загруженный график/);
  assert.doesNotMatch(cache, /saveTimesheet|updateTimesheet|supabase/);
});

test("client error reports are authenticated, limited and filtered", async () => {
  const [client, sql] = await Promise.all([
    source("errorLogger.js"),
    source("supabase-sql/035_client_error_logging.sql"),
  ]);

  assert.match(client, /MAX_REPORTS_PER_SESSION = 3/);
  assert.match(client, /failed to fetch/i);
  assert.match(client, /navigator\.onLine/);
  assert.match(sql, /alter table public\.client_error_logs enable row level security/i);
  assert.match(sql, /revoke all on table public\.client_error_logs from anon, authenticated/i);
  assert.match(sql, /auth\.uid\(\)/i);
  assert.match(sql, /grant execute[\s\S]*to authenticated/i);
  assert.doesNotMatch(sql, /grant execute[\s\S]*to anon/i);
  assert.match(sql, /profiles\.role = 'owner'/i);
  assert.match(sql, /revoke all on function public\.owner_list_client_errors\(integer\) from public, anon/i);
});

test("critical RLS and SECURITY DEFINER protections remain in migrations", async () => {
  const [hardening, rpcRestrictions, errorLogging] = await Promise.all([
    source("supabase-sql/026_security_hardening.sql"),
    source("supabase-sql/029_restrict_security_definer_execute.sql"),
    source("supabase-sql/035_client_error_logging.sql"),
  ]);

  assert.match(hardening, /alter table public\.profiles enable row level security/i);
  assert.match(hardening, /alter table public\.timesheets enable row level security/i);
  assert.match(hardening, /trg_validate_profile_write/i);
  assert.match(hardening, /trg_validate_timesheet_write/i);
  assert.match(rpcRestrictions, /revoke execute on function %s from public, anon/i);
  assert.match(errorLogging, /set search_path = public, pg_temp/i);
});
