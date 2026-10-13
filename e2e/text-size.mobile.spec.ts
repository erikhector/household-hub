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
}

for (const locale of LOCALES) {
  test.describe(`dashboard at 200% text (${locale})`, () => {
    test.use({ storageState: locale === "sv" ? STORAGE_STATE_SV : STORAGE_STATE });
    test.beforeEach(async ({ context, baseURL }) => {
      await dismissCookieNotice(context, baseURL!);
    });
    for (const route of DASHBOARD_ROUTES) {
      test(`${route.path} has no sideways scroll`, async ({ page }) => {
        await expectSurvivesDoubleText(page, route);
      });
    }
  });

  test.describe(`public pages at 200% text (${locale})`, () => {
    test.use({ storageState: { cookies: [], origins: [] } });
    test.beforeEach(async ({ context, baseURL }) => {
      await setLocaleCookie(context, baseURL!, locale);
      await dismissCookieNotice(context, baseURL!);
    });
    for (const route of PUBLIC_ROUTES) {
      test(`${route.path} has no sideways scroll`, async ({ page }) => {
        await expectSurvivesDoubleText(page, route);
      });
    }
  });
}
