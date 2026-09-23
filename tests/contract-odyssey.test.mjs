import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("contract Odyssey is available in profile and owner controls", async () => {
  const [profilePage, profileScript, ownerControl, migration] = await Promise.all([
    read("profile.html"),
    read("js/profile.js"),
    read("js/ownerUserControl.js"),
    read("supabase-sql/055_contract_odyssey_branch.sql"),
  ]);
  for (const source of [profilePage, profileScript, ownerControl, migration]) {
    assert.match(source, /contract_odyssey/);
  }
});

test("admin table separates Chateau and Odyssey and scopes schedule tools", async () => {
  const [page, admin, tools] = await Promise.all([
    read("admin.html"),
    read("js/admin.js"),
    read("js/features/adminScheduleTools.js"),
  ]);
  assert.match(page, /АЛВИСА ШАТО/);
  assert.match(page, /АЛВИСА ОДИССЕЙ/);
  assert.match(page, /id="matrixBodyOdyssey"/);
  assert.match(page, /data-schedule-scope="chateau"/);
  assert.match(page, /data-schedule-scope="odyssey"/);
  assert.match(admin, /plantScope: member\?\.branch === ODYSSEY_BRANCH \? "odyssey" : "chateau"/);
  assert.match(admin, /teamStates: teamStates\.filter\(\(state\) => state\.plantScope === scope\)/);
  assert.match(tools, /getContext\(activeScope\)/);
});

test("idea form waits for owner push delivery request", async () => {
  const dialog = await read("js/ideaDialog.js");
  assert.match(dialog, /await sendPushNotifications\(\{ type: "project_idea_submitted" \}\)/);
  assert.doesNotMatch(dialog, /void sendPushNotifications\(\{ type: "project_idea_submitted" \}\)/);
});
