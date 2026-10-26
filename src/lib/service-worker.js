// Registered from src/components/pwa/service-worker-registration.tsx (every
// page, via the root layout) and also from
// src/components/profile/push-notifications-card.tsx (for the push-
// subscription flow specifically — registration is idempotent, so both
// calls resolve to the same registration) via
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
      // Monochrome white-on-transparent (public/badge.png): Android tints
      // badge pixels, so the full-colour app icon would render as a blob.
      badge: "/badge.png",
      data: { url: url || "/dashboard" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data.url;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // A tap raises the tab the user already has open instead of spawning
      // a new one per notification.
      const open = clientList.find((client) => "focus" in client);
      if (!open) return self.clients.openWindow(url);
      const target = new URL(url, self.location.origin);
      // An empty client URL (a tab still on its initial blank page) would
      // throw in new URL() — fall back to our own origin, which matches a
      // same-origin target and just raises the tab otherwise.
      if (new URL(open.url || self.location.origin).origin === target.origin && "navigate" in open) {
        // navigate() can resolve null (the navigation went elsewhere) —
        // focus the original tab either way.
        return open.navigate(target.href).then((client) => (client ?? open).focus());
      }
      return open.focus();
    }),
  );
});

// --- Minimal offline fallback -----------------------------------------------
//
// docs/archive/UX_AUDIT_IMPLEMENTATION_PLAN.md's G3: installing Squirrel via the browser's
// native "Install app" prompt implies some baseline resilience, but until
// now this service worker did nothing but push — no `fetch` handler at all,
// so a page load with no network just hit the browser's own generic offline
// error. Real offline support (caching and serving actual inventory/budget/
// meal-planning data while offline) is a much bigger lift than fits here —
// this app's pages are server-rendered per-request against a live Postgres
// database behind auth, so meaningfully "working offline" would mean an
// entire local-data-sync layer, not a service worker change. What's in
// scope-sized reach instead: never show the browser's bare connection-error
// page for a full page load. Full-page navigations get that fallback; the
// only other thing the worker touches is `/_next/static/*` (see "Hashed
// static assets" below). RSC data fetches, API routes and server actions
// pass straight through untouched, network-only.
const OFFLINE_CACHE_NAME = "squirrel-offline-v1";
const OFFLINE_CACHE_URL = "/~offline-fallback";

// No i18n dictionary access from a service worker (no cookies/session to
// read locale from) — a request's own Accept-Language header is the only
// signal available, so this picks between two hardcoded strings rather than
// pulling in src/lib/i18n. Kept deliberately tiny/inline: this is a last-
// resort fallback, not a real page.
function offlineHtml(preferSwedish) {
  const text = preferSwedish
    ? { title: "Du är offline", body: "Squirrel behöver internet. Återanslut och försök igen." }
    : { title: "You're offline", body: "Squirrel needs an internet connection. Reconnect and try again." };
  return `<!doctype html><html lang="${preferSwedish ? "sv" : "en"}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${text.title}</title><body style="display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;background:#0a0a0a;color:#fafafa;font-family:system-ui,sans-serif;text-align:center"><div><h1 style="font-size:1.25rem;margin:0 0 8px">${text.title}</h1><p style="margin:0;opacity:0.7">${text.body}</p></div></body></html>`;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(OFFLINE_CACHE_NAME).then((cache) =>
      Promise.all([
        cache.put(OFFLINE_CACHE_URL, new Response(offlineHtml(false), { headers: { "Content-Type": "text/html" } })),
        cache.put(
          `${OFFLINE_CACHE_URL}-sv`,
          new Response(offlineHtml(true), { headers: { "Content-Type": "text/html" } }),
        ),
      ]),
    ),
  );
  // Takes over immediately rather than waiting for every open tab of the
  // previous version to close — this worker precaches no app shell, and the
  // static cache below is keyed by content-hashed URLs that never go stale,
  // so unlike a typical precache worker there's no old page a new worker
  // version could leave inconsistent.
  self.skipWaiting();
});

// --- Hashed static assets (PERF-28) -------------------------------------------
//
// An installed app's cold launch used to re-download every JS/CSS chunk
// (~325 KB gz) whenever the OS had evicted the HTTP cache, which iOS does
// aggressively. Next names everything under /_next/static/ by content hash,
// so a cached copy can never be stale and a cache-first lookup is always
// safe. Pages, RSC payloads, API routes and Server Actions are NOT cached
// here, which keeps the "no app shell" reasoning above intact: the HTML
// always comes from the network, only the files it points at come from disk.
//
// There's no list of "files the current build references" to prune against
// (no precache manifest, on purpose), so the cache is capped by entry count
// instead: when it grows past STATIC_CACHE_MAX the oldest entries (cache
// keys come back in insertion order) are dropped. The cap is a few builds'
// worth of chunks, so a release that changes most chunks still leaves room
// for the next one without evicting what the current page needs.
const STATIC_CACHE_NAME = "squirrel-static-v1";
const STATIC_CACHE_MAX = 400;
const STATIC_PATH_PREFIX = "/_next/static/";

async function trimStaticCache() {
  const cache = await caches.open(STATIC_CACHE_NAME);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - STATIC_CACHE_MAX)).map((key) => cache.delete(key)));
}

async function cacheFirstStatic(event) {
  const cache = await caches.open(STATIC_CACHE_NAME);
  const hit = await cache.match(event.request);
  if (hit) return hit;
  const response = await fetch(event.request);
  // Only a complete, successful, same-origin response is worth keeping: a
  // 404 or an opaque cross-origin one cached under a hashed name would be
  // served forever.
  if (response.status === 200 && response.type === "basic") {
    event.waitUntil(cache.put(event.request, response.clone()).then(trimStaticCache));
  }
  return response;
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Drop static caches left behind by an older version of this worker
      // that used a different name (a bump of STATIC_CACHE_NAME).
      caches
        .keys()
        .then((names) =>
          Promise.all(
            names
              .filter((name) => name.startsWith("squirrel-static-") && name !== STATIC_CACHE_NAME)
              .map((name) => caches.delete(name)),
          ),
        ),
    ]),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method === "GET" && !request.headers.has("range")) {
    const url = new URL(request.url);
    if (url.origin === self.location.origin && url.pathname.startsWith(STATIC_PATH_PREFIX)) {
      event.respondWith(cacheFirstStatic(event));
      return;
    }
  }

  if (event.request.mode !== "navigate") return;

  event.respondWith(
    fetch(event.request).catch(async () => {
      const preferSwedish = (event.request.headers.get("Accept-Language") || "").toLowerCase().startsWith("sv");
      const cached = await caches.match(preferSwedish ? `${OFFLINE_CACHE_URL}-sv` : OFFLINE_CACHE_URL);
      return cached || Response.error();
    }),
  );
});
