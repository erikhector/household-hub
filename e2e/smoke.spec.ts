import { expect, test } from "@playwright/test";
import { DASHBOARD_ROUTES } from "./routes";
import { STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { collectErrors, dismissCookieNotice, expectRendersCleanly, LOCALES, saveScreenshot } from "./ui";

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
        expect(errors, `console/page errors on ${route.path}`).toEqual([]);
      });
    }
  });
}
