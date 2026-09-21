import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("push failures are translated into actionable user messages", async () => {
  const [push, settings] = await Promise.all([
    read("js/pushNotifications.js"),
    read("js/settings.js"),
  ]);

  assert.match(push, /export function getPushFailureReason/);
  assert.match(push, /Проверьте интернет и VPN/);
  assert.match(push, /Отключите уведомления, включите их снова/);
  assert.match(settings, /pushNotificationsHint\.textContent = reason/);
});
