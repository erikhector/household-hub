import { expect, test } from "@playwright/test";
import { overflowMobileNavItems, primaryMobileNavItems } from "@/components/dashboard/nav-items";
import { en } from "@/lib/i18n/dictionaries/en";
import { E2E_SHOPPING_LIST } from "./seed-data";
import { gotoRevealed } from "./ui";

// Mobile only (the `mobile` project in playwright.config.ts): the bottom
// bar's tabs and its "More" menu between them reach every section, and the
// desktop sidebar is hidden. Driven from nav-items.ts so moving a section
// between the bar and "More" keeps this in step.
test("the bottom bar reaches the primary sections", async ({ page }) => {
  await page.goto("/dashboard");
  const nav = page.getByRole("navigation");
  // Only the bottom bar is visible at phone width; the sidebar is sm:flex.
  await expect(nav).toHaveCount(1);

  for (const item of primaryMobileNavItems) {
    await nav.getByRole("link", { name: en.nav[item.key], exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${item.href}$`));
  }
});

test("the More menu reaches every other section", async ({ page }) => {
  await page.goto("/dashboard");
  for (const item of overflowMobileNavItems) {
    await page.getByRole("navigation").getByRole("button", { name: en.nav.more }).click();
    await page.getByRole("menuitem", { name: en.nav[item.key], exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${item.href}$`));
  }
});

// SEC-5: the "Log out" menu item grabs this browser's push subscription
// endpoint client-side before signing out — check it still logs out and
// redirects even though there's no subscription to find in a fresh test
// browser.
test("logs out and redirects to login", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("navigation").getByRole("button", { name: en.nav.more }).click();
  await page.getByRole("menuitem", { name: en.nav.logOut }).click();
  await expect(page).toHaveURL(/\/login/);
});

test("the bottom bar doesn't cover the end of a long page", async ({ page }) => {
  // The list detail page is seeded with rows (e2e/seed.ts). Scrolled to the
  // bottom, its last element must sit above the fixed bar, not under it:
  // that's what main's bottom padding in dashboard/layout.tsx is for.
  // gotoRevealed (e2e/ui.ts): plain goto can return while main still shows
  // the skeleton. Scroll and measure in one go, polled, in case the page
  // still settles after that, and only a page that actually scrolls counts,
  // so without the padding it never passes.
  await gotoRevealed(page, `/dashboard/shopping-list/${E2E_SHOPPING_LIST.id}`);
  const main = page.getByRole("main");
  // The bar is fixed, so it's measured once; getByRole skips the hidden
  // sidebar <nav>.
  const bar = await page.getByRole("navigation").boundingBox();
  expect(bar, "bottom bar is visible").not.toBeNull();
  await expect
    .poll(
      () =>
        main.evaluate((el, barTop) => {
          el.scrollTo(0, el.scrollHeight);
          const last = el.lastElementChild?.getBoundingClientRect();
          return el.scrollHeight > el.clientHeight && !!last && last.bottom <= barTop + 1;
        }, bar!.y),
      { message: "the page scrolls and its last content block ends above the bottom bar" },
    )
    .toBe(true);
});

// UX-27: What's new and Notifications live in the More menu, so on their
// pages "More" is the marked tab instead of no tab at all.
test("More is marked on pages reached from its menu", async ({ page }) => {
  const nav = page.getByRole("navigation");
  const more = nav.getByRole("button", { name: en.nav.more });
  for (const path of ["/dashboard/whats-new", "/dashboard/notifications", "/dashboard/profile"]) {
    await page.goto(path);
    await expect(more).toHaveAttribute("aria-current", "page");
  }
  await page.goto("/dashboard/inventory");
  await expect(more).not.toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: en.nav.inventory })).toHaveAttribute("aria-current", "page");
});

// UX-27 / M9: the bar's labels are at least 12 px.
test("the bottom bar labels are at least 12 px", async ({ page }) => {
  await page.goto("/dashboard");
  const nav = page.getByRole("navigation");
  for (const name of [en.nav.overview, en.nav.inventory, en.nav.more]) {
    const size = await nav
      .getByText(name, { exact: true })
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(12);
  }
});
