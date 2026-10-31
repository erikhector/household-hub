import { expect, test } from "@playwright/test";
import { PUBLIC_ROUTES } from "./routes";
import { collectErrors, dismissCookieNotice, expectRendersCleanly, expectTouchTargets, LOCALES, saveScreenshot, setLocaleCookie } from "./ui";

// The logged-out pages (landing, auth forms, legal pages, and the
// token-link pages in their "invalid link" state), with the same checks as
// smoke.spec.ts. No stored session: these are what a new visitor sees.
test.use({ storageState: { cookies: [], origins: [] } });

for (const locale of LOCALES) {
  test.describe(`public (${locale})`, () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await setLocaleCookie(context, baseURL!, locale);
      await dismissCookieNotice(context, baseURL!);
    });

    for (const route of PUBLIC_ROUTES) {
      test(`${route.path} renders cleanly`, async ({ page }, testInfo) => {
        const errors = collectErrors(page);
        await expectRendersCleanly(page, route);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        // M3 on the logged-out pages too (UX-19); touch projects only.
        if (testInfo.project.name !== "desktop") await expectTouchTargets(page);
        await saveScreenshot(page, testInfo, locale, route);
        expect(errors, `console/page errors on ${route.path}`).toEqual([]);
      });
    }
  });
}

// UX-17: a visitor with no cookie gets the browser's language, and can
// switch from the public footer without an account.
test.describe("public language toggle", () => {
  test.use({ locale: "sv-SE" });

  test("/join/<token> follows Accept-Language, then switches to English", async ({ page, context, baseURL }) => {
    await dismissCookieNotice(context, baseURL!);
    await page.goto("/join/e2e-invalid-token");
    await expect(page.getByRole("heading", { name: "Ogiltig inbjudan" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "sv");

    // The footer names the language in use (UX-51); a tap switches to the other.
    await page.getByRole("button", { name: "Byt språk: Svenska" }).click();
    await expect(page.getByRole("heading", { name: "Invalid invite" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    // The choice is stored (locale cookie), so it survives a reload even
    // though the browser still asks for Swedish.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Invalid invite" })).toBeVisible();
  });
});

// UX-164 (axe `landmark-one-main`): the auth and token-link pages wrap their
// content in one `main`, so a screen-reader user can jump straight to it.
test.describe("auth pages have one main landmark", () => {
  for (const path of [
    "/login",
    "/signup",
    "/forgot-password",
    "/join/e2e-invalid-token",
    "/reset-password/e2e-invalid-token",
    "/verify-email/e2e-invalid-token",
    "/unsubscribe/e2e-invalid-token",
  ]) {
    test(path, async ({ page, context, baseURL }) => {
      await dismissCookieNotice(context, baseURL!);
      await page.goto(path);
      await expect(page.getByRole("main")).toHaveCount(1);
    });
  }
});
