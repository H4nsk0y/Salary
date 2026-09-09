import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (fileName) => readFile(new URL(`../${fileName}`, import.meta.url), "utf8");

test("mobile build uses an isolated allowlisted web directory", async () => {
  const [config, buildScript, gitignore] = await Promise.all([
    read("capacitor.config.json"),
    read("scripts/build-mobile.mjs"),
    read(".gitignore"),
  ]);

  assert.equal(JSON.parse(config).webDir, "www");
  assert.match(buildScript, /copiedRootExtensions/);
  assert.match(buildScript, /copiedDirectories/);
  assert.doesNotMatch(buildScript, /supabase-sql|db-dump|docs|tests/);
  assert.match(gitignore, /^www\/$/m);
});

test("native shell does not register browser PWA or Web Push", async () => {
  const [pwa, push, settings] = await Promise.all([
    read("pwa.js"),
    read("pushNotifications.js"),
    read("settings.js"),
  ]);

  assert.match(pwa, /if \(isNativeApp\(\)\) \{\s*emitState\(\);\s*return;/);
  assert.match(push, /!isNativeApp\(\)/);
  assert.match(settings, /state\?\.native/);
});

test("Android shell keeps sessions out of backups and rejects cleartext traffic", async () => {
  const [manifest, login] = await Promise.all([
    read("android/app/src/main/AndroidManifest.xml"),
    read("login.js"),
  ]);

  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(login, /isNativeApp\(\)[\s\S]*https:\/\/h4nsk0y\.ru\/login\.html/);
});

test("manual Android workflow builds an isolated debug APK without repository secrets", async () => {
  const workflow = await read(".github/workflows/android-debug.yml");

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /npm run cap:sync/);
  assert.match(workflow, /chmod \+x gradlew/);
  assert.match(workflow, /assembleDebug/);
  assert.match(workflow, /app-debug\.apk/);
  assert.doesNotMatch(workflow, /secrets\./);
});
