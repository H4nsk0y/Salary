self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() || "" };
  }

  const title = payload.title || "Alvisa";
  const options = {
    body: payload.body || "Появилось новое уведомление.",
    icon: payload.icon || "./images/favicon-180.png?v=4",
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
