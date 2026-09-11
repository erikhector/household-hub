// Registered from src/components/profile/push-notifications-card.tsx via
// `new URL('../../lib/service-worker.js', import.meta.url)` — Next bundles
// this as a hashed, same-origin static asset, so it already gets immutable
// caching and cache-busting on every build without any next.config.ts
// header changes.
//
// Payloads are sent by sendPushToHousehold (src/lib/push.ts) as
// `{ title, body, url }` — `url` is where notificationclick below should
// take the user (mirrors notificationHref() in
// src/components/notifications/notification-bell.tsx).
self.addEventListener("push", (event) => {
  if (!event.data) return;

  const { title, body, url } = event.data.json();
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon.png",
      badge: "/icon.png",
      data: { url: url || "/dashboard" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data.url));
});
