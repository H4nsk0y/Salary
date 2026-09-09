import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("database size is exposed through an owner-only RPC", async () => {
  const [sql, db] = await Promise.all([
    read("supabase-sql/044_owner_database_health.sql"),
    read("db.js"),
  ]);

  assert.match(sql, /owner_get_database_health/);
  assert.match(sql, /500 \* 1024 \* 1024/);
  assert.match(sql, /pg_database_size\(current_database\(\)\)/);
  assert.match(sql, /if not public\.is_owner\(\)/);
  assert.match(sql, /revoke all on function public\.owner_get_database_health\(\)[\s\S]*from public, anon/i);
  assert.match(db, /export async function ownerGetDatabaseHealth/);
  assert.match(db, /supabase\.rpc\("owner_get_database_health"\)/);
});

test("system status warns at 70 percent and becomes critical at 80 percent", async () => {
  const [html, script] = await Promise.all([
    read("owner-status.html"),
    read("owner-status.js"),
  ]);

  assert.match(script, /percent >= 80/);
  assert.match(script, /percent >= 70/);
  assert.match(script, /Размер базы данных/);
  assert.match(script, /status-usage-track/);
  assert.match(script, /Критично: использовано/);
  assert.match(html, /\.status-usage-fill\.warn/);
  assert.match(html, /\.status-usage-fill\.error/);
  assert.match(html, /Критично \/ недоступно/);
});
