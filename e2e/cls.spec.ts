import { expect, test } from "@playwright/test";
import { DASHBOARD_ROUTES } from "./routes";
import { dismissCookieNotice } from "./ui";

// UX-42 acceptance: Cumulative Layout Shift under 0.05 on every dashboard
// route. Lighthouse isn't part of this repo's toolchain, so this reads the
// same signal Lighthouse does (the browser's `layout-shift` entries, ignoring
// shifts within 500 ms of a tap or key) straight from the page, on a hard
// load: the case where Suspense boundaries stream in after the first paint.
// Runs on the desktop and mobile (Pixel 7) projects like every spec.
const CLS_BUDGET = 0.05;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

// The hard load below has no latency, so each Suspense section streams in
// before the first paint. A client navigation with every RSC payload held
// back is the slow-network case: the route's `loading.tsx` skeleton (or the
// previous page) shows, then the real page replaces it, and that swap must
// not move the layout.
const RSC_DELAY_MS = 800;
const SETTLE_MS = 1200;

for (const route of DASHBOARD_ROUTES) {
  test(`${route.pattern} does not shift when it replaces its skeleton`, async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number };
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
          if (!entry.hadRecentInput) w.__cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    // Start somewhere else so the navigation is a real route change.
    const start = route.path.startsWith("/dashboard/profile") ? "/dashboard/tasks" : "/dashboard/profile";
    await page.goto(start);
    await expect(page.locator("main")).toBeVisible();
    await page.waitForLoadState("networkidle");

    await page.route(
      (url) => url.searchParams.has("_rsc"),
      async (r) => {
        await new Promise((resolve) => setTimeout(resolve, RSC_DELAY_MS));
        await r.continue().catch(() => {});
      },
    );
    await page.evaluate(() => {
      (window as unknown as { __cls: number }).__cls = 0;
    });
    await page.evaluate((path) => {
      (window as unknown as { next: { router: { push: (p: string) => void } } }).next.router.push(path);
    }, route.path);
    // A prefetched route (the bottom bar's links) paints its skeleton at
    // once; one that wasn't keeps the old page until the payload lands. Both
    // end in a swap, and that swap is what's measured.
    await page.waitForTimeout(RSC_DELAY_MS + SETTLE_MS);
    await expect(page.locator("main")).toBeVisible();
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls, `CLS swapping in ${route.pattern}`).toBeLessThan(CLS_BUDGET);
  });
}

for (const route of DASHBOARD_ROUTES) {
  test(`${route.pattern} does not shift while loading`, async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number };
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
          if (!entry.hadRecentInput) w.__cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(route.path);
    await expect(page.locator("main")).toBeVisible();
    await page.waitForLoadState("networkidle");
    // Late shifts (a streamed section arriving after networkidle) still count.
    await page.waitForTimeout(1000);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls, `CLS on ${route.pattern}`).toBeLessThan(CLS_BUDGET);
  });
}
