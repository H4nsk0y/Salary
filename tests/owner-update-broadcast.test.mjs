import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("owner can manually notify only active push subscribers about an update", async () => {
  const [page, owner, db, sql] = await Promise.all([
    read("owner.html"),
    read("js/owner.js"),
    read("js/db.js"),
    read("supabase-sql/056_owner_product_update_broadcast.sql"),
  ]);
  assert.match(page, /id="broadcastUpdatesBtn"/);
  assert.match(owner, /await confirmDialog\(\{/);
  assert.match(owner, /ownerBroadcastProductUpdate\(\)/);
  assert.match(owner, /sendPushNotifications\(\{ type: "product_update", allUsers: true \}\)/);
  assert.match(db, /owner_broadcast_product_update/);
  assert.match(sql, /if not public\.is_owner\(\)/i);
  assert.match(sql, /from public\.push_subscriptions subscription[\s\S]*subscription\.enabled = true/i);
  assert.match(sql, /'updates\.html'/);
});
