import { expect, test } from "@playwright/test";
import { navItems } from "@/components/dashboard/nav-items";
import { en } from "@/lib/i18n/dictionaries/en";

// Desktop only (the `desktop` project in playwright.config.ts): every
// sidebar entry reaches its section, and the bottom bar stays out of the
// way. Labels and hrefs come from the same nav-items.ts + dictionary the
// sidebar renders from, so a new section is covered without editing this.
test("the sidebar reaches every section", async ({ page }) => {
  await page.goto("/dashboard");
  const nav = page.getByRole("navigation");
  // Only the sidebar is visible at desktop width; the phone bar is sm:hidden.
  await expect(nav).toHaveCount(1);

  for (const item of navItems) {
    await nav.getByRole("link", { name: en.nav[item.key], exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${item.href}$`));
    await expect(page.locator("main")).toBeVisible();
  }
});

// SEC-5: the sidebar's "Log out" button (unlike a plain form submit before
// it) grabs this browser's push subscription endpoint client-side before
// signing out — check it still logs out and redirects even though there's
// no subscription to find in a fresh test browser.
test("logs out and redirects to login", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: en.nav.logOut }).click();
  await expect(page).toHaveURL(/\/login/);
});
