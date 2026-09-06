const CACHE_PREFIX = "alvisa-pwa";
const CACHE_VERSION = "v4";
const STATIC_CACHE = `${CACHE_PREFIX}-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}-runtime-${CACHE_VERSION}`;
const OFFLINE_URL = new URL("./offline.html", self.registration.scope).href;
const CORE_ASSETS = [
  OFFLINE_URL,
  new URL("./manifest.webmanifest", self.registration.scope).href,
  new URL("./images/app-icon-192.png", self.registration.scope).href,
  new URL("./images/app-icon-512.png", self.registration.scope).href,
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(CORE_ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && ![STATIC_CACHE, RUNTIME_CACHE].includes(key))
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response?.ok) {
      try {
        const cache = await caches.open(RUNTIME_CACHE);
        await cache.put(request, response.clone());
      } catch {
        // A full or unavailable cache must not discard a successful download.
      }
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function handleNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    return caches.match(OFFLINE_URL);
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (["script", "style", "image", "font"].includes(request.destination)) {
    event.respondWith(networkFirst(request));
  }
});

self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() || "" };
  }

  const title = payload.title || "ALVISA SALARY";
  const options = {
    body: payload.body || "Появилось новое уведомление.",
    icon: payload.icon || "./images/app-icon-192.png",
    badge: payload.badge || "./images/favicon-48.png?v=4",
    tag: payload.tag || "alvisa-notification",
    renotify: false,
    data: {
      url: payload.url || "./profile.html",
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

function safeNotificationUrl(value) {
  const scopeUrl = new URL(self.registration.scope);
  const fallbackUrl = new URL("./profile.html", scopeUrl);

  try {
    const targetUrl = new URL(String(value || ""), scopeUrl);
    const allowedProtocol = targetUrl.protocol === "https:" || targetUrl.protocol === "http:";
    const insideScope = targetUrl.pathname.startsWith(scopeUrl.pathname);
    return allowedProtocol && targetUrl.origin === scopeUrl.origin && insideScope
      ? targetUrl.href
      : fallbackUrl.href;
  } catch {
    return fallbackUrl.href;
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = safeNotificationUrl(event.notification?.data?.url);

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url === targetUrl && "focus" in client) {
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }

      return null;
    })
  );
});
