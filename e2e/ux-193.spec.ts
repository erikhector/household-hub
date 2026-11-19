import { expect, test, type Page } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { expectHydrated, expectRouterPatched, gotoRevealed } from "./ui";

// UX-193 (DESIGN.md M7): Back returns to where the reader was, not to the
// top of the page and not merely to the section a hash names. Profile is
// the page it was found on: scroll down to "See what's new", follow it,
// press Back. On the desktop project the document scrolls; on the phone
// only <main> does, and no browser restores that by itself.

// Whichever of the two scrolls; the other one stays at 0.
function scrollOffset(page: Page) {
  return page.evaluate(() => Math.max(window.scrollY, document.getElementById("main-content")!.scrollTop));
}

// Back has two paths. While the router still has Profile cached, React
// brings it back at once. After a reload of the page in between it has to
// be fetched again, and its loading skeleton shows first: a screen tall,
// which is what clamps the position a browser restores to the top.
for (const [name, url, refetch] of [
  ["without a hash", "/dashboard/profile", false],
  ["with a hash", "/dashboard/profile#profile-notifications", false],
  ["without a hash, fetched again", "/dashboard/profile", true],
  ["with a hash, fetched again", "/dashboard/profile#profile-notifications", true],
] as const) {
  test(`Back to Profile restores the scroll position, ${name}`, async ({ page }) => {
    await gotoRevealed(page, url);
    const main = page.getByRole("main");
    // The link sits in the closed About disclosure. A native <details>
    // opens without React, but one opened before React has hydrated the
    // page was found closed again afterwards (a full ci:local run, phone,
    // with a hash), and the link is then no longer there to find. So wait
    // for React to own the summary first. Positions are remembered from
    // hydration on too, and the link's click is the router's only once it
    // has patched history.
    const about = main.getByText(en.profile.about.title, { exact: true });
    await expectHydrated(about);
    await expectRouterPatched(page);
    await about.click();
    const link = main.getByRole("link", { name: en.profile.about.whatsNewLink });
    await expect(link).toBeVisible();
    // Scroll the way a reader does: until the link comes up from the bottom
    // edge. Not all the way down, since Back brings the page back with the
    // disclosure closed again, so a little shorter than it was left.
    await link.evaluate((el) => el.scrollIntoView({ block: "end" }));
    await expect(link).toBeInViewport({ ratio: 1 });
    const before = await scrollOffset(page);
    // Profile is taller than the screen on both projects, so this is a real
    // offset and "back at the top" can't pass for it.
    expect(before).toBeGreaterThan(50);

    // Hold Profile back from here on, as on a slow phone, so a Back that
    // fetches it has its skeleton on screen for a while.
    await page.route(/\/dashboard\/profile/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.continue();
    });
    await link.click();
    await expect(page).toHaveURL(/\/dashboard\/whats-new$/);
    const whatsNew = page.getByRole("heading", { level: 1, name: en.whatsNew.title, exact: true });
    await expect(whatsNew).toBeVisible();
    if (refetch) {
      await page.reload();
      // Back is the router's only once it listens again.
      await expectHydrated(whatsNew);
      await expectRouterPatched(page);
    }

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${url}$`));
    await expect(page.getByRole("heading", { level: 1, name: en.profile.title, exact: true })).toBeVisible();
    await expect.poll(async () => Math.abs((await scrollOffset(page)) - before)).toBeLessThanOrEqual(3);
    // And it stays there: nothing (the hash's own scroll) moves it after.
    await page.waitForTimeout(500);
    expect(Math.abs((await scrollOffset(page)) - before)).toBeLessThanOrEqual(3);
  });
}
