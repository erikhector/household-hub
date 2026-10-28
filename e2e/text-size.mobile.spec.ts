import { expect, test, type Page } from "@playwright/test";
import { DASHBOARD_ROUTES, PUBLIC_ROUTES, type UiRoute } from "./routes";
import { STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { dismissCookieNotice, expectNoHorizontalOverflow, LOCALES, setLocaleCookie } from "./ui";

// UX-9: with the root font-size at 200% (Android "Font size", iOS Larger
// Text in the installed app) every rem-sized control doubles while the
// phone stays 412 px wide, so anything built from fixed-width siblings or
// `nowrap` buttons scrolled sideways. Swedish is checked too, its words
// are longer.
test.skip(({ isMobile }) => !isMobile, "text size is a phone setting");

// UX-150: at 200% the bottom bar's labels used to break inside a word
// ("Overvi/ew") and the floating primary action slid under the taller bar.
// A label now stays on one line (truncated, never split), and whatever floats
// above the bar clears the bar's real, measured box.
async function expectBottomBarHolds(page: Page) {
  const nav = page.locator("nav.fixed.bottom-0");
  await expect(nav).toBeVisible();
  const labels = await nav.evaluate((el) =>
    [...el.querySelectorAll<HTMLElement>("a > span:last-child, button > span:last-child")].map((span) => ({
      text: (span.textContent ?? "").trim(),
      lines: Math.round(span.getBoundingClientRect().height / parseFloat(getComputedStyle(span).lineHeight)),
      hyphens: getComputedStyle(span).hyphens,
      wrap: getComputedStyle(span).overflowWrap,
    })),
  );
  expect(labels.length).toBeGreaterThanOrEqual(5);
  for (const label of labels) {
    expect(label.lines, `"${label.text}" wraps`).toBe(1);
    expect(label.hyphens, `"${label.text}" hyphenates`).toBe("manual");
    expect(label.wrap, `"${label.text}" breaks anywhere`).toBe("normal");
  }
  const navBox = (await nav.boundingBox())!;
  const floating = page.locator("[data-primary-action]");
  for (const box of await Promise.all((await floating.all()).map((el) => el.boundingBox()))) {
    if (!box) continue;
    expect(box.y + box.height, "floating action sits above the bar").toBeLessThanOrEqual(navBox.y + 0.5);
  }
}

async function expectSurvivesDoubleText(page: Page, route: UiRoute) {
  await page.goto(route.path);
  // After navigation so it survives hydration; the app sizes everything in
  // rem, so one rule on the root is the whole setting.
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await page.waitForLoadState("networkidle");
  await expectNoHorizontalOverflow(page);
  // A button that wraps its label must grow with it: Button's `max-sm:h-11`
  // beats a bare `h-auto`, which left wrapped text spilling out of a 44 px
  // box. Same rule everywhere, so every visible button is checked.
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-slot="button"]')]
      .filter((el) => el.getBoundingClientRect().width > 0 && el.scrollHeight > el.clientHeight + 1)
      .map((el) => `${(el.textContent ?? "").trim().slice(0, 40)} (${el.scrollHeight}px > ${el.clientHeight}px)`),
  );
  expect(clipped, "buttons whose wrapped text overflows their box").toEqual([]);
  if (route.path.startsWith("/dashboard")) await expectBottomBarHolds(page);
}

for (const locale of LOCALES) {
  test.describe(`dashboard at 200% text (${locale})`, () => {
    test.use({ storageState: locale === "sv" ? STORAGE_STATE_SV : STORAGE_STATE });
    test.beforeEach(async ({ context, baseURL }) => {
      await dismissCookieNotice(context, baseURL!);
    });
    for (const route of DASHBOARD_ROUTES) {
      test(`${route.pattern} has no sideways scroll`, async ({ page }) => {
        await expectSurvivesDoubleText(page, route);
      });
    }
  });

  test.describe(`empty meal week at 200% text (${locale})`, () => {
    test.use({ storageState: locale === "sv" ? STORAGE_STATE_SV : STORAGE_STATE });
    test("the first-dinner button clears the bottom bar", async ({ page, context, baseURL }) => {
      await dismissCookieNotice(context, baseURL!);
      // A far-future week nobody plans in, so it is empty for every run.
      await page.goto("/dashboard/meal-planning?week=2032-03-02");
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      await page.waitForLoadState("networkidle");
      const first = page.locator("main button[aria-haspopup='dialog']").first();
      await first.scrollIntoViewIfNeeded();
      const [box, navBox] = await Promise.all([first.boundingBox(), page.locator("nav.fixed.bottom-0").boundingBox()]);
      expect(box!.y + box!.height).toBeLessThanOrEqual(navBox!.y + 0.5);
      await expectBottomBarHolds(page);
    });
  });

  test.describe(`public pages at 200% text (${locale})`, () => {
    test.use({ storageState: { cookies: [], origins: [] } });
    test.beforeEach(async ({ context, baseURL }) => {
      await setLocaleCookie(context, baseURL!, locale);
      await dismissCookieNotice(context, baseURL!);
    });
    for (const route of PUBLIC_ROUTES) {
      test(`${route.pattern} has no sideways scroll`, async ({ page }) => {
        await expectSurvivesDoubleText(page, route);
      });
    }
  });
}
