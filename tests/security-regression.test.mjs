import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

globalThis.location = new URL("https://h4nsk0y.github.io/Salary/login.html");
const profileCompletionSource = await source("profileCompletion.js");
const profileCompletion = await import(
  `data:text/javascript;base64,${Buffer.from(profileCompletionSource).toString("base64")}`
);

test("redirect helper allows only URLs inside the current application", () => {
  const normalize = profileCompletion.normalizeInternalNextUrl;

  assert.equal(normalize("table.html?month=7#day-2"), "/Salary/table.html?month=7#day-2");
  assert.equal(normalize("/Salary/profile.html"), "/Salary/profile.html");
  assert.equal(normalize("https://attacker.example/steal"), "/Salary/table.html");
  assert.equal(normalize("//attacker.example/steal"), "/Salary/table.html");
  assert.equal(normalize("javascript:alert(1)"), "/Salary/table.html");
  assert.equal(normalize("../admin.html", ""), "");
});

test("login, notifications and service worker use safe navigation", async () => {
  assert.match(await source("login.js"), /normalizeInternalNextUrl/);
  assert.match(await source("nav.js"), /normalizeInternalNextUrl\(item\.url/);
  assert.match(await source("service-worker.js"), /safeNotificationUrl/);
});

test("profile updates are restricted on both client and database layers", async () => {
  const db = await source("db.js");
  const sql = await source("supabase-sql/026_security_hardening.sql");

  assert.match(db, /MY_PROFILE_MUTABLE_FIELDS/);
  assert.match(db, /Запрещённые поля профиля/);
  assert.match(sql, /revoke insert, update, delete on table public\.profiles from authenticated/i);
  assert.match(sql, /PROFILE_ROLE_DENIED/);
  assert.doesNotMatch(sql, /grant update[\s\S]{0,500}\brole\b[\s\S]{0,100}on table public\.profiles/i);
});

test("server rejects malformed timesheets and unsafe outbound values", async () => {
  const sql = await source("supabase-sql/026_security_hardening.sql");

  assert.match(sql, /TIMESHEET_PAYLOAD_TOO_LARGE/);
  assert.match(sql, /DAILY_HOURS_LIMIT_EXCEEDED/);
  assert.match(sql, /INVALID_NOTIFICATION_URL/);
  assert.match(sql, /INVALID_PUSH_ENDPOINT/);
  assert.match(sql, /avatars_write_path_restriction/);
});

test("scheduled Edge Function requires a separate cron secret", async () => {
  const edge = await source("supabase/functions/send-egais-file-reminders/index.ts");
  const cron = await source("supabase-sql/028_secure_egais_cron.sql");

  assert.match(edge, /requiredEnv\("CRON_SECRET"\)/);
  assert.match(edge, /x-cron-secret/);
  assert.match(cron, /alvisa_egais_cron_secret/g);
});

test("13:00 EGAIS reminder is limited to a day-only shift", async () => {
  const edge = await source("supabase/functions/send-egais-file-reminders/index.ts");
  const departureBranch = edge.match(
    /if \(kind === "departure_check"\) \{([\s\S]*?)\} else if \(phase === "night"\)/
  )?.[1] ?? "";

  assert.match(edge, /return shift\.day > 0 && shift\.night === 0/);
  assert.match(departureBranch, /isDayShift/);
  assert.doesNotMatch(departureBranch, /hasAnyShift/);
});

test("00:15 EGAIS reminder recognizes standard and reduced full-night patterns", async () => {
  const edge = await source("supabase/functions/send-egais-file-reminders/index.ts");

  assert.match(edge, /sameHours\(shift\.night, 5\)/);
  assert.match(edge, /sameHours\(shift\.day, 1\)[\s\S]*sameHours\(shift\.day, 2\)/);
  assert.match(edge, /sameHours\(shift\.night, 7\)/);
  assert.match(edge, /sameHours\(shift\.day, 3\)[\s\S]*sameHours\(shift\.day, 4\)/);
});

test("anonymous users cannot execute SECURITY DEFINER application RPCs", async () => {
  const sql = await source("supabase-sql/029_restrict_security_definer_execute.sql");

  assert.match(sql, /p\.prosecdef/);
  assert.match(sql, /revoke execute on function %s from public, anon/i);
  assert.match(sql, /grant execute on function %s to authenticated/i);
  assert.match(sql, /handle_new_user\(\)[\s\S]*from public, anon, authenticated/i);
});

test("money PIN uses a slow versioned hash while legacy PINs remain readable", async () => {
  const money = await source("moneyPrivacy.js");

  assert.match(money, /PBKDF2/);
  assert.match(money, /PIN_HASH_ITERATIONS = 150000/);
  assert.match(money, /Existing SHA-256 PINs keep working/);
  assert.match(money, /escapeHtml\(title\)/);
});

test("client source does not contain server-only credentials", async () => {
  const clientFiles = [
    "config.js",
    "auth.js",
    "db.js",
    "nav.js",
    "profile.js",
    "settings.js",
    "table.js",
  ];
  const combined = (await Promise.all(clientFiles.map(source))).join("\n");

  assert.doesNotMatch(combined, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(combined, /VAPID_PRIVATE_KEY/);
  assert.doesNotMatch(combined, /postgres(?:ql)?:\/\//i);
});
