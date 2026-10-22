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
  for (const name of [en.nav.overview, en.nav.inventory]) {
    const size = await nav
      .getByText(name, { exact: true })
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(12);
  }
  // More's label is a bare text node inside its button, next to the unread
  // badge, so the button's whole text reads "1 More" whenever another spec
  // left a notification in the worker's household. Assert the exact text of
  // the label node itself instead of the button's combined text.
  const more = nav.getByRole("button", { name: new RegExp(`${en.nav.more}$`) });
  const { label, size } = await more.evaluate((el) => ({
    label: Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent)
      .join("")
      .trim(),
    size: parseFloat(getComputedStyle(el).fontSize),
  }));
  expect(label).toBe(en.nav.more);
  expect(size).toBeGreaterThanOrEqual(12);
});

// UX-52: all five tabs share one icon treatment (a tile), so their labels sit
// on one baseline; the active tab keeps its section hue, and the page it
// opens is marked with the same hue.
test("bottom bar tabs share one tile and the active one keeps its hue", async ({ page }) => {
  await page.goto("/dashboard/inventory");
  const nav = page.getByRole("navigation");
  const tabs = [
    ...primaryMobileNavItems.map((item) => nav.getByRole("link", { name: en.nav[item.key], exact: true })),
    nav.getByRole("button", { name: en.nav.more }),
  ];
  expect(tabs).toHaveLength(5);

  // Same baseline: every tab's tile and its label (the last span) sit at one
  // height. "More" used to have no tile and a taller line box.
  for (const which of ["first", "last"] as const) {
    const tops = await Promise.all(
      tabs.map((tab) => tab.locator("span")[which]().evaluate((el) => el.getBoundingClientRect().top)),
    );
    for (const top of tops) expect(Math.abs(top - tops[0])).toBeLessThanOrEqual(1);
  }

  // The active tab (Inventory) keeps its tinted tile instead of dropping it.
  const inventory = nav.getByRole("link", { name: en.nav.inventory, exact: true });
  await expect(inventory).toHaveAttribute("aria-current", "page");
  await expect(inventory.locator("span").first()).toHaveClass(/bg-chart-1\/15/);

  // The page is marked with the same section hue.
  await expect(page.locator("[data-section-accent='chart-1']")).toBeVisible();
});
