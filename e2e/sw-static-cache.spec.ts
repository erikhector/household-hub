import { expect, test } from "@playwright/test";
import { dismissCookieNotice } from "./ui";

// PERF-28: the service worker keeps /_next/static/* (content-hashed JS/CSS)
// in its own cache so an installed app's cold launch doesn't re-download
// them once the OS has evicted the HTTP cache. Pages, RSC payloads and API
// routes must never end up there.

test("the service worker caches hashed static assets and nothing else", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await page.goto("/dashboard");
  // A first visit has no time_zone cookie, so TimeZoneCookie writes it and
  // router.refresh()es the overview once. If that refresh lands on the last
  // reloaded page (its effect can run after the worker is ready, since it
  // hydrates inside the dashboard layout) and is still in flight when the
  // context goes offline, Next falls back to a full browser navigation on
  // the failed RSC fetch and the offline evaluate below loses its page
  // ("Execution context was destroyed", MAINT-96). Waiting for the cookie
  // here means every reload below is served with it and never refreshes.
  const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  await expect
    .poll(async () =>
      // The zone's "/" is stored percent-encoded.
      (await context.cookies()).some((cookie) => cookie.name === "time_zone" && decodeURIComponent(cookie.value) === zone),
    )
    .toBe(true);
  await page.evaluate(() => navigator.serviceWorker.ready);
  // The first load ran before the worker controlled the page, so its chunks
  // went to the network only; a reload is fetched through the worker.
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await page.reload();

  const cachedUrls = () =>
    page.evaluate(async () => {
      const cache = await caches.open("squirrel-static-v1");
      return (await cache.keys()).map((request) => new URL(request.url).pathname);
    });
  await expect.poll(async () => (await cachedUrls()).length).toBeGreaterThan(0);

  const urls = await cachedUrls();
  expect(urls.every((path) => path.startsWith("/_next/static/"))).toBe(true);

  // A cached chunk is served with the network gone: that's the point.
  await context.setOffline(true);
  try {
    const status = await page.evaluate((path) => fetch(path).then((response) => response.status), urls[0]);
    expect(status).toBe(200);
  } finally {
    await context.setOffline(false);
  }
});
