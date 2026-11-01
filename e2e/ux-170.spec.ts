import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { dismissCookieNotice, expectHydrated } from "./ui";

// UX-170: the budget and meal-planning tab tracks fade at the edge that has
// more tabs behind it, and open scrolled to the active tab, so a clipped
// "Insi" reads as "more this way".
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

// The tablist is `display: contents`, so the scrolling track is its parent.
const track = (page: Page) => page.getByRole("tab").first().locator("xpath=../..");

// Audit shots of the narrowed track, with the fade and without it (the old
// look), for the UX scout. Off unless E2E_SCREENSHOT_DIR is set.
async function shootTrack(bar: ReturnType<typeof track>, testInfo: TestInfo, name: string) {
  const dir = process.env.E2E_SCREENSHOT_DIR;
  if (!dir) return;
  const base = `${dir}/ux-170-${testInfo.project.name}-${name}`;
  await bar.screenshot({ path: `${base}-after.png` });
  // Put the mask back afterwards: it is React's inline style, not ours.
  const mask = await bar.evaluate((el) => el.style.maskImage);
  await bar.evaluate((el) => (el.style.maskImage = "none"));
  await bar.screenshot({ path: `${base}-before.png` });
  await bar.evaluate((el, m) => (el.style.maskImage = m), mask);
}

for (const path of ["/dashboard/budget", "/dashboard/meal-planning"]) {
  test(`${path}: the tab track fades while it can scroll`, async ({ page }, testInfo) => {
    await page.goto(path);
    await expectHydrated(page.getByRole("tab").first());
    const bar = track(page);
    // Narrow the track instead of the viewport: a phone-emulated page
    // doesn't go below ~412 px, and 200 % text is the same overflow.
    await bar.evaluate((el) => (el.style.maxWidth = "200px"));
    await expect(bar).toHaveAttribute("data-fade", "end");
    await shootTrack(bar, testInfo, path.split("/").pop()!);
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
  // A 200 px track from the first paint, so the mount effect has something
  // to scroll (a phone page never goes below ~412 px).
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = "div.overflow-x-auto[data-activation-direction]{max-width:200px}";
    document.documentElement.append(style);
  });
  await page.goto("/dashboard/budget?tab=insights");
  await expectHydrated(page.getByRole("tab").first());
  // Insights also holds its own compact switch, so scope to the page tabs.
  const bar = track(page);
  const insights = bar.getByRole("tab", { selected: true });
  await expect(insights).toHaveText("Insights");
  await expect
    .poll(() =>
      insights.evaluate((el) => {
        const [a, b] = [el.getBoundingClientRect(), el.parentElement!.parentElement!.getBoundingClientRect()];
        return a.left >= b.left - 1 && a.right <= b.right + 1;
      }),
    )
    .toBe(true);
});
