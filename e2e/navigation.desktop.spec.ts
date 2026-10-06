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

// UX-7: on a short screen (a phone in landscape, the `landscape` project)
// the sidebar used to be h-screen with only its nav list scrolling, so the
// footer rows left that list a ~40 px window and most sections were out of
// reach. Now the whole aside scrolls there. Scrolling just the aside (not
// the nav inside it) must bring every link and footer control fully into
// view; with the old inner scroll this did nothing and the links stayed
// clipped.
test("every sidebar control can be scrolled into view", async ({ page }) => {
  await page.goto("/dashboard");
  const aside = page.locator("aside");
  const controls = aside.locator("a[href], button");
  await expect(controls.first()).toBeVisible();
  const count = await controls.count();
  expect(count).toBeGreaterThan(navItems.length);

  for (let i = 0; i < count; i++) {
    const control = controls.nth(i);
    await control.evaluate((el) => {
      const sidebar = el.closest("aside")!;
      sidebar.scrollTop += el.getBoundingClientRect().top - sidebar.getBoundingClientRect().top - 8;
    });
    await expect(control).toBeInViewport({ ratio: 1 });
  }
});

// UX-7: Tailwind's preflight makes an <svg> a block, so a back-link that
// isn't a flex row puts its arrow on a line of its own above the label.
test("a back-link keeps its arrow on the label's line", async ({ page }) => {
  await page.goto("/dashboard/shopping-list/e2e-shopping-list");
  const back = page.getByRole("link", { name: en.shoppingList.backToAll });
  const [link, icon] = await Promise.all([back.boundingBox(), back.locator("svg").boundingBox()]);
  expect(link && icon).toBeTruthy();
  // On one row the arrow is centred on the link; stacked, it sat at the
  // top with the label below it, ~10 px above the link's middle.
  expect(Math.abs(icon!.y + icon!.height / 2 - (link!.y + link!.height / 2))).toBeLessThan(2);
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

// UX-27: the current page is marked everywhere, including the footer pages
// that aren't in navItems.
test("the sidebar marks the current page, footer pages included", async ({ page }) => {
  await page.goto("/dashboard/inventory");
  const aside = page.locator("aside");
  await expect(aside.getByRole("link", { name: en.nav.inventory, exact: true })).toHaveAttribute("aria-current", "page");
  await expect(aside.getByRole("link", { name: en.nav.shoppingList, exact: true })).not.toHaveAttribute("aria-current", "page");

  await page.goto("/dashboard/whats-new");
  await expect(aside.getByRole("link", { name: new RegExp(`^${en.nav.whatsNew}`) })).toHaveAttribute("aria-current", "page");

  await page.goto("/dashboard/notifications");
  await expect(aside.getByRole("button", { name: new RegExp(en.notifications.title) })).toHaveAttribute("aria-current", "page");
});

// UX-27: collapsed, the rail's icons were named only by `title`, which touch
// never shows. They now carry an aria-label (role queries find them by it)
// and a Tooltip on hover.
test("the collapsed sidebar names its icons and shows a tooltip", async ({ page }) => {
  await page.goto("/dashboard");
  const aside = page.locator("aside");
  await aside.getByRole("button", { name: en.nav.collapseSidebar }).click();
  await expect(aside.getByRole("button", { name: en.nav.expandSidebar })).toBeVisible();

  for (const item of navItems) {
    await expect(aside.getByRole("link", { name: en.nav[item.key], exact: true })).toBeVisible();
  }
  await expect(aside.getByRole("button", { name: en.nav.logOut })).toBeVisible();

  await aside.getByRole("link", { name: en.nav.inventory, exact: true }).hover();
  await expect(page.locator("[data-side]").filter({ hasText: en.nav.inventory })).toBeVisible();
});
