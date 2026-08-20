import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("staff voting periods follow Moscow calendar weeks and months", async () => {
  const sql = await source("supabase-sql/031_staff_voting.sql");

  assert.match(sql, /time zone 'Europe\/Moscow'/i);
  assert.match(sql, /date_trunc\('week'/i);
  assert.match(sql, /date_trunc\('month'/i);
  assert.match(sql, /unique \(voter_user_id, period_type, period_start\)/i);
});

test("voting rules reject self votes and repeated votes", async () => {
  const sql = await source("supabase-sql/031_staff_voting.sql");

  assert.match(sql, /staff_votes_not_self/i);
  assert.match(sql, /SELF_VOTE_DENIED/i);
  assert.match(sql, /unique_violation[\s\S]*ALREADY_VOTED/i);
});

test("voter identities and active totals are not exposed to the client", async () => {
  const sql = await source("supabase-sql/031_staff_voting.sql");
  const commentsFunction = sql.match(
    /create or replace function public\.list_completed_staff_vote_comments[\s\S]*?\$\$;\s*/i
  )?.[0] || "";
  const periodFunction = sql.match(
    /create or replace function public\.get_staff_vote_periods[\s\S]*?\$\$;\s*/i
  )?.[0] || "";

  assert.match(sql, /revoke all on table public\.staff_votes from anon, authenticated/i);
  assert.doesNotMatch(commentsFunction, /returns table[\s\S]*voter_user_id/i);
  assert.doesNotMatch(periodFunction, /current[^\n]*votes|active[^\n]*votes/i);
  assert.match(commentsFunction, /staff_vote_results/i);
});

test("tie winner is randomized once and then persisted", async () => {
  const sql = await source("supabase-sql/031_staff_voting.sql");

  assert.match(sql, /floor\(random\(\)/i);
  assert.match(sql, /staff_vote_results[\s\S]*on conflict \(period_type, period_start\) do nothing/i);
  assert.match(sql, /honorable_mentions/i);
  assert.match(
    sql,
    /revoke all on function public\.finalize_staff_vote_period\(text, date, date\) from public, anon, authenticated/i
  );
});

test("voting page is in navigation after shifts and renders database text safely", async () => {
  const [nav, html, script] = await Promise.all([
    source("nav.js"),
    source("voting.html"),
    source("voting.js"),
  ]);

  assert.ok(nav.indexOf('key: "schedule"') < nav.indexOf('key: "voting"'));
  assert.ok(nav.indexOf('key: "voting"') < nav.indexOf('key: "profile"'));
  assert.match(html, /data-active="voting"/);
  assert.match(html, /voting\.js\?v=20260820-1/);
  assert.match(script, /textContent/);
  assert.doesNotMatch(script, /\.innerHTML\s*=/);
});
