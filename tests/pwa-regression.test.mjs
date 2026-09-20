import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("manifest describes an installable scoped application", () => {
  const manifest = JSON.parse(read("manifest.webmanifest"));
  const sizes = new Set(manifest.icons.map((icon) => icon.sizes));

  assert.equal(manifest.scope, "./");
  assert.match(manifest.start_url, /^\.\/index\.html/);
  assert.equal(manifest.display, "standalone");
  assert.ok(sizes.has("192x192"));
  assert.ok(sizes.has("512x512"));
  assert.ok(existsSync(new URL("images/app-icon-192.png", root)));
  assert.ok(existsSync(new URL("images/app-icon-512.png", root)));
});

test("service worker keeps offline, update and push behavior together", () => {
  const worker = read("service-worker.js");

  assert.match(worker, /offline\.html/);
  assert.match(worker, /js\/offline\.js/);
  assert.match(worker, /addEventListener\("fetch"/);
  assert.match(worker, /SKIP_WAITING/);
  assert.match(worker, /addEventListener\("push"/);
  assert.match(worker, /addEventListener\("notificationclick"/);
  assert.match(worker, /safeNotificationUrl/);
});

test("offline retry works without inline JavaScript", () => {
  const html = read("offline.html");
  assert.match(html, /id="offlineRetryBtn"/);
  assert.match(html, /src="\.\/js\/offline\.js/);
  assert.doesNotMatch(html, /onclick=/);
});

test("common navigation registers PWA support", () => {
  assert.match(read("js/nav.js"), /import "\.\/pwa\.js"/);
  assert.match(read("login.html"), /src="\.\/js\/pwa\.js"/);
  assert.match(read("js/pwa.js"), /beforeinstallprompt/);
  assert.match(read("js/pwa.js"), /appinstalled/);
  assert.match(read("js/pwa.js"), /controllerchange/);
});

test("settings expose installation controls", () => {
  const html = read("settings.html");
  const script = read("js/settings.js");

  assert.match(html, /id="pwaInstallBtn"/);
  assert.match(html, /id="pwaInstallHint"/);
  assert.match(script, /requestPwaInstall/);
  assert.match(script, /checkForPwaUpdate/);
});

test("iOS pages use a seamless translucent status bar", () => {
  const pages = readdirSync(root)
    .filter((name) => name.endsWith(".html") && name !== "offline.html");

  for (const page of pages) {
    assert.match(
      read(page),
      /apple-mobile-web-app-status-bar-style" content="black-translucent"/,
      `${page} must extend its background under the iOS status bar`
    );
  }
});
