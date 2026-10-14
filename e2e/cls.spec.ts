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
