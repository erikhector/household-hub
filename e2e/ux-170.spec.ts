import { expect, test, type Page } from "@playwright/test";
import { dismissCookieNotice, expectHydrated } from "./ui";

// UX-170: the budget and meal-planning tab tracks fade at the edge that has
// more tabs behind it, and open scrolled to the active tab, so a clipped
// "Insi" reads as "more this way".
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

// The tablist is `display: contents`, so the scrolling track is its parent.
const track = (page: Page) => page.getByRole("tab").first().locator("xpath=../..");

for (const path of ["/dashboard/budget", "/dashboard/meal-planning"]) {
  test(`${path}: the tab track fades while it can scroll`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(path);
    await expectHydrated(page.getByRole("tab").first());
    const bar = track(page);
    await expect(bar).toHaveAttribute("data-fade", "end");
    expect(await bar.evaluate((el) => getComputedStyle(el).maskImage)).toContain("linear-gradient");

    await bar.evaluate((el) => (el.scrollLeft = el.scrollWidth));
    await expect(bar).toHaveAttribute("data-fade", "start");
  });

  test(`${path}: no fade when every tab fits`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(path);
    await expectHydrated(page.getByRole("tab").first());
    await expect(track(page)).not.toHaveAttribute("data-fade", /.+/);
  });
}

test("the active tab is scrolled into view on load", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/dashboard/budget?tab=insights");
  await expectHydrated(page.getByRole("tab").first());
  await expect(page.getByRole("tab", { selected: true })).toBeInViewport({ ratio: 0.95 });
});
