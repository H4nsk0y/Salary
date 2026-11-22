import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import test from "node:test";

const root = new URL("../", import.meta.url);
const worker = readFileSync(new URL("service-worker.js", root), "utf8");

function fixture({ failCache = false, status = 200 } = {}) {
  const files = new Map();
  const requests = [];
  const tasks = [];
  const listeners = {};
  const context = createContext({
    URL, Request, Response, Headers, Uint8Array,
    self: { registration: { scope: "https://example.com/" }, location: { origin: "https://example.com" }, addEventListener: (name, handler) => { listeners[name] = handler; } },
    caches: {
      open: async () => ({
        match: async request => files.get(request.url)?.clone(),
        put: async (request, response) => { if (failCache) throw new Error("quota"); files.set(request.url, response.clone()); },
      }),
      match: async request => files.get(request.url)?.clone(),
    },
    fetch: async request => {
      requests.push(request);
      return new Response(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), { status, headers: { "Content-Type": "audio/mpeg", "Content-Length": "10" } });
    },
  });
  runInContext(worker, context);
  return {
    files, requests, context, listeners,
    async media(range, path = "/media/festive-new-year-160k.mp3") {
      context.request = new Request("https://example.com" + path, { headers: range ? { Range: range } : {} });
      context.event = { waitUntil: promise => tasks.push(promise) };
      const response = await runInContext("cachedMedia(request, event)", context);
      await Promise.all(tasks);
      return response;
    },
  };
}

test("media is downloaded once as a complete file and reused", async () => {
  const f = fixture();
  assert.equal((await f.media("bytes=0-")).status, 200);
  assert.equal(f.requests[0].headers.get("range"), null);
  assert.equal(f.files.size, 1);
  assert.equal((await f.media()).status, 200);
  assert.equal(f.requests.length, 1);
  const partial = await f.media("bytes=2-5");
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(partial.headers.get("content-length"), "4");
  assert.deepEqual([...new Uint8Array(await partial.arrayBuffer())], [2, 3, 4, 5]);
  assert.equal(f.requests.length, 1);
});

test("cached audio supports seeking, suffix ranges and invalid bounds", async () => {
  const f = fixture();
  await f.media();
  for (const [range, expected] of [["bytes=7-", [7,8,9]], ["bytes=-3", [7,8,9]], ["bytes=8-99", [8,9]], ["bytes=-99", [0,1,2,3,4,5,6,7,8,9]]]) {
    const response = await f.media(range);
    assert.equal(response.status, 206);
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], expected);
  }
  for (const range of ["bytes=10-", "bytes=8-2", "bytes=-0", "bytes=99999999999999999999-"]) {
    const response = await f.media(range);
    assert.equal(response.status, 416);
    assert.equal(response.headers.get("content-range"), "bytes */10");
  }
  assert.equal(f.requests.length, 1);
});

test("cache quota and partial network responses never break playback or poison cache", async () => {
  const f = fixture({ failCache: true });
  assert.equal((await f.media()).status, 200);
  assert.equal(f.files.size, 0);
  const partial = fixture({ status: 206 });
  assert.equal((await partial.media()).status, 206);
  assert.equal(partial.files.size, 0);
});

test("cache-first is limited to known media and versioned public images/fonts", () => {
  const f = fixture();
  for (const [path, destination, expected] of [
    ["/images/festive-ded-moroz-144.webp", "image", true],
    ["/media/almost-here-160k.mp3", "audio", true],
    ["/media/festive-new-year-160k.mp3", "audio", true],
    ["/images/favicon-32.png?v=4", "image", true],
    ["/fonts/Anticva-Regular.otf?v=2", "font", true],
    ["/js/nav.js?v=1", "script", false],
    ["/styles/tailwind.css?v=1", "style", false],
    ["/images/unversioned.png", "image", false],
    ["/private/avatar?v=1", "image", false],
    ["/budget.html", "document", false],
  ]) {
    f.context.url = new URL("https://example.com" + path);
    f.context.request = { destination };
    assert.equal(runInContext("isVersionedMedia(request, url)", f.context), expected, path);
  }
});

test("small sprite variants and both tracks stay inside their media budgets", () => {
  for (const width of [72, 144, 216]) {
    const size = statSync(new URL(`images/festive-ded-moroz-${width}.webp`, root)).size;
    assert.ok(size > 1000 && size < 40_000);
  }
  assert.ok(statSync(new URL("media/almost-here-160k.mp3", root)).size < 5_300_000);
  assert.ok(statSync(new URL("media/festive-new-year-160k.mp3", root)).size < 2_600_000);
});
