import { expect, test } from "@playwright/test";
import { DASHBOARD_ROUTES } from "./routes";
import { STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { collectErrors, dismissCookieNotice, expectRendersCleanly, expectTouchTargets, LOCALES, saveScreenshot } from "./ui";

// Every dashboard page, in both languages, on both the desktop and the
// mobile project: it must render without hitting an error boundary or
// logging a client-side error, and nothing may be wider than the screen.
// Cheap, broad coverage: it's the first thing to catch a page an
// autonomous change broke without touching its tests. The page list lives
// in e2e/routes.ts, which a unit test keeps in sync with src/app.
for (const locale of LOCALES) {
  test.describe(`dashboard (${locale})`, () => {
    // Signed in, the language comes from the account, not the cookie, so
    // each locale runs as its own seeded user (e2e/seed.ts).
    test.use({ storageState: locale === "sv" ? STORAGE_STATE_SV : STORAGE_STATE });
    test.beforeEach(async ({ context, baseURL }) => {
      await dismissCookieNotice(context, baseURL!);
    });

    for (const route of DASHBOARD_ROUTES) {
      test(`${route.path} renders cleanly`, async ({ page }, testInfo) => {
        const errors = collectErrors(page);
        await expectRendersCleanly(page, route);
        await expect(page.locator("main")).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await saveScreenshot(page, testInfo, locale, route);
        // M3 is a phone rule; desktop is deliberately denser.
        if (testInfo.project.name === "mobile") await expectTouchTargets(page);
        expect(errors, `console/page errors on ${route.path}`).toEqual([]);
      });
    }
  });
}

// UX-15: dates are written in the viewer's language, not the runtime's
// default locale. Pinned to a fixed month and week so the check doesn't
// depend on today's date. collectErrors also catches a hydration mismatch
// between the server's and the browser's formatting.
test.describe("dates in Swedish (sv)", () => {
  test.use({ storageState: STORAGE_STATE_SV });
  test.beforeEach(async ({ context, baseURL }) => {
    await dismissCookieNotice(context, baseURL!);
  });

  for (const path of ["/dashboard/budget", "/dashboard/personal-budget"]) {
    test(`${path} names the month in Swedish`, async ({ page }) => {
      const errors = collectErrors(page);
      await page.goto(`${path}?month=2026-10`);
      await expect(page.locator("main").getByText("oktober 2026", { exact: true })).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  test("the meal planner shows a Swedish week range", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/dashboard/meal-planning?week=2026-09-28");
    await expect(page.locator("main").getByText("28 sep.–4 okt. 2026", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
