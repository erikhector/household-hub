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

// Caps the track at 200 px from the first paint, so the mount effect that
// scrolls to the active tab runs on a track narrower than its tabs. The
// style goes in <head>: one appended straight to <html> (as these tests first
// did) is dropped when React hydrates the document, which left the track at
// full width, so the scroll-on-load test passed without testing anything.
// <head> doesn't exist yet when an init script runs, so wait for the parser.
async function narrowTrackFromFirstPaint(page: Page) {
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = "div.overflow-x-auto[data-activation-direction]{max-width:200px}";
    const add = () => (document.head ? (document.head.append(style), true) : false);
    if (!add()) {
      const observer = new MutationObserver(() => add() && observer.disconnect());
      observer.observe(document, { childList: true, subtree: true });
    }
  });
}

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
    // The track opens scrolled to the active tab, and that mount effect can
    // land after this narrowing under a loaded runner (React commits the
    // hydrated tree a task after the tab gets its props), so the scroll
    // position is set here rather than left to that race (MAINT-81). The
    // fade must still follow it: a scroll to 0 reads "end".
    await bar.evaluate((el) => {
      el.style.maxWidth = "200px";
      el.scrollLeft = 0;
    });
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
  await narrowTrackFromFirstPaint(page);
  await page.goto("/dashboard/budget?tab=insights");
  await expectHydrated(page.getByRole("tab").first());
  // Insights also holds its own compact switch, so scope to the page tabs.
  const bar = track(page);
  const insights = bar.getByRole("tab", { selected: true });
  await expect(insights).toHaveText("Insights");
  // The track really is narrower than its tabs, or there is nothing to test.
  await expect(bar).toHaveAttribute("data-fade", /.+/);
  await expect
    .poll(() =>
      insights.evaluate((el) => {
        const [a, b] = [el.getBoundingClientRect(), el.parentElement!.parentElement!.getBoundingClientRect()];
        return a.left >= b.left - 1 && a.right <= b.right + 1;
      }),
    )
    .toBe(true);
});

// MAINT-84: the mount effect measured the active tab with `offsetLeft`, which
// counts from the nearest positioned ancestor (not the track), so on a track
// narrower than its tabs even the first tab's target landed past the end and
// the track opened scrolled to its last tab, reading "start" instead of
// "end". Only a narrow track from the first paint shows it, because on the
// real page the track is wide enough to clamp the scroll back to 0.
test("the first tab's track opens at its start, not scrolled away", async ({ page }) => {
  await narrowTrackFromFirstPaint(page);
  await page.goto("/dashboard/budget");
  await expectHydrated(page.getByRole("tab").first());
  const bar = track(page);
  await expect(bar).toHaveAttribute("data-fade", "end");
  expect(await bar.evaluate((el) => el.scrollLeft)).toBe(0);
});
