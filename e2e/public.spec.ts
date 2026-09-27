import { expect, test } from "@playwright/test";
import { PUBLIC_ROUTES } from "./routes";
import { collectErrors, expectRendersCleanly, LOCALES, saveScreenshot, setLocaleCookie } from "./ui";

// The logged-out pages (landing, auth forms, legal pages, and the
// token-link pages in their "invalid link" state), with the same checks as
// smoke.spec.ts. No stored session: these are what a new visitor sees.
test.use({ storageState: { cookies: [], origins: [] } });

for (const locale of LOCALES) {
  test.describe(`public (${locale})`, () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await setLocaleCookie(context, baseURL!, locale);
    });

    for (const route of PUBLIC_ROUTES) {
      test(`${route.path} renders cleanly`, async ({ page }, testInfo) => {
        const errors = collectErrors(page);
        await expectRendersCleanly(page, route);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await saveScreenshot(page, testInfo, locale, route);
        expect(errors, `console/page errors on ${route.path}`).toEqual([]);
      });
    }
  });
}
