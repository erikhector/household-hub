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

// UX-165 (M2): the menu opens upward, so its last row is the one under the
// thumb. Log out is the top row, not the last.
test("Log out is the top row of the More menu, not the last", async ({ page }) => {
  await page.goto("/dashboard");
  const more = page.getByRole("navigation").getByRole("button", { name: en.nav.more });
  await expectHydrated(more);
  await more.click();
  const rows = page.getByRole("menuitem");
  await expect(rows.first()).toHaveText(en.nav.logOut);
  await expect(rows.last()).not.toHaveText(en.nav.logOut);
});

// UX-165 follow-up: Log out is the first row, so a keyboard open must not
// leave it as the row the next Enter or Space would activate.
test("opened from the keyboard, Log out is not the highlighted row", async ({ page }) => {
  await page.goto("/dashboard");
  const more = page.getByRole("navigation").getByRole("button", { name: en.nav.more });
  await expectHydrated(more);
  await more.focus();
  await page.keyboard.press("Enter");
  const logOut = page.getByRole("menuitem", { name: en.nav.logOut });
  await expect(logOut).toBeVisible();
  await expect(logOut).not.toHaveAttribute("data-highlighted", "");
  await expect(logOut).not.toBeFocused();
  // The next Enter or Space must not sign out.
  await page.keyboard.press("Enter");
  await expect(page).not.toHaveURL(/\/login/);
  // The attribute checked above is the real highlight marker: ArrowDown
  // moves it onto the first row, which proves the "not highlighted" check
  // above could have failed.
  await page.keyboard.press("ArrowDown");
  await expect(logOut).toHaveAttribute("data-highlighted", "");
});
