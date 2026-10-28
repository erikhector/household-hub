import { expect, test } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { dismissCookieNotice, expectHydrated } from "./ui";

// PERF-27: the bottom bar's More menu is its own chunk, mounted on the first
// tap. Phone only, because the bar is.
test.beforeEach(async ({ context, baseURL, page }) => {
  await dismissCookieNotice(context, baseURL!);
  await page.addInitScript(() => {
    window.requestIdleCallback = () => 0;
  });
});

test("More opens its menu on the first tap without the idle prefetch, and again after", async ({ page }) => {
  await page.goto("/dashboard");
  const more = page.getByRole("navigation").getByRole("button", { name: en.nav.more });
  await expectHydrated(more);
  await more.click();
  const logOut = page.getByRole("menuitem", { name: en.nav.logOut });
  await expect(logOut).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(logOut).toBeHidden();
  await page.getByRole("navigation").getByRole("button", { name: en.nav.more }).click();
  await expect(logOut).toBeVisible();
});

test.describe("a failed chunk load", () => {
  test.use({ serviceWorkers: "block" });

  test("says so, and the next tap retries", async ({ page }) => {
    await page.goto("/dashboard");
    const more = page.getByRole("navigation").getByRole("button", { name: en.nav.more });
    await expectHydrated(more);
    let offline = true;
    await page.route("**/_next/static/**/*.js", (route) => (offline ? route.abort() : route.continue()));
    await more.click();
    await expect(page.getByText(en.errors.generic)).toBeVisible();
    await expect(page.getByRole("menuitem", { name: en.nav.logOut })).toBeHidden();

    offline = false;
    await more.click();
    await expect(page.getByRole("menuitem", { name: en.nav.logOut })).toBeVisible();
  });
});
