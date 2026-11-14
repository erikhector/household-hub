import { expect, test } from "@playwright/test";
import releases from "../src/lib/release-notes/releases.json";
import { dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow, expectRouterPatched } from "./ui";

// UX-190: both What's new pages render the newest ten releases and a
// "Show older updates" link (to ?all=1) for the rest, instead of every
// release as a card (~138 000 px tall on a phone).
const RECENT = 10;
const latest = releases[0].version;

for (const path of ["/dashboard/whats-new", "/whats-new"]) {
  test.describe(path, () => {
    if (path === "/whats-new") test.use({ storageState: { cookies: [], origins: [] } });

    test.beforeEach(async ({ context, baseURL }) => {
      await dismissCookieNotice(context, baseURL!);
    });

    test("shows the newest ten releases and folds the rest behind Show older updates", async ({ page }) => {
      await page.goto(path);
      // Scoped to the release list: the dashboard's nav has lists of its own.
      const list = page.getByRole("list").filter({ has: page.getByRole("heading", { name: `Version ${latest}`, exact: true }) });
      const headings = list.getByRole("heading", { level: 2 });
      await expect(headings).toHaveCount(RECENT);
      const newest = list.getByRole("listitem").first();
      await expect(newest.getByRole("heading", { name: `Version ${latest}`, exact: true })).toBeVisible();
      await expect(newest.getByText("Latest", { exact: true })).toBeVisible();

      const showOlder = page.getByRole("link", { name: "Show older updates" });
      await expect(showOlder).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await showOlder.click();

      await expect(page).toHaveURL(/[?&]all=1/);
      await expect(headings).toHaveCount(releases.length);
      await expect(page.getByRole("link", { name: "Show older updates" })).toHaveCount(0);
      // Still newest first, and the reader lands on the first older release
      // rather than back at the top of a list they already read.
      await expect(list.getByRole("listitem").first().getByText("Latest", { exact: true })).toBeVisible();
      await expect(list.getByRole("heading", { name: `Version ${releases[RECENT].version}`, exact: true })).toBeInViewport();
    });

    // UX-192: once hydrated the link is a soft navigation, and the link that
    // had focus is gone from the ?all=1 page. Next scrolls to the hash target
    // but doesn't focus it, so without FocusReleaseAnchor focus falls to
    // <body> and a keyboard or screen-reader user starts again from the top
    // of the page (M10).
    test("moves focus to the first older release after Show older updates", async ({ page }) => {
      await page.goto(path);
      const showOlder = page.getByRole("link", { name: "Show older updates" });
      // Before hydration Enter is a full page load, which is a different path
      // (the browser's own fragment navigation, not Next's router).
      await expectHydrated(showOlder);
      await expectRouterPatched(page);
      await showOlder.focus();
      await page.keyboard.press("Enter");

      await expect(page).toHaveURL(/[?&]all=1/);
      const firstOlder = page.locator(`[id="release-${releases[RECENT].version}"]`);
      await expect(firstOlder).toBeFocused();
      // No focus ring: the card takes focus as a place to carry on from, it
      // isn't something to press.
      await expect(firstOlder).toHaveCSS("outline-style", "none");
      await expect(firstOlder).toBeInViewport();
    });
  });
}
