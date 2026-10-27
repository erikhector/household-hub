import { expect, test, type Locator, type Page } from "@playwright/test";
import { COOKIE_NOTICE_COOKIE } from "@/lib/cookie-inventory";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";
import { LOCALE_COOKIE } from "@/lib/i18n/locales";

// UX-57: the cookie notice is a slim strip that the page makes room for, so
// while it shows, nothing a person needs on a phone sits underneath it.
// Phone-only: from sm the notice is a floating card (cookie-notice.spec.ts
// covers dismissing it).
const notice = (page: Page) => page.getByRole("region", { name: en.cookieNotice.title });

async function expectClearOfNotice(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const [box, strip] = await Promise.all([target.boundingBox(), notice(page).boundingBox()]);
  expect(box).not.toBeNull();
  expect(strip).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(strip!.y + 0.5);
}

test.describe("logged out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the strip is slim and quiet", async ({ page }) => {
    await page.goto("/login");
    await expect(notice(page)).toBeVisible();
    const strip = (await notice(page).boundingBox())!;
    expect(strip.height).toBeLessThanOrEqual(72);
    // Outline, not the solid purple primary.
    await expect(notice(page).getByRole("button", { name: en.cookieNotice.dismiss })).not.toHaveClass(
      /(^|\s)bg-primary(\s|$)/,
    );
  });

  // UX-148: the "Läs mer" link used to be a 44 px inline-flex box inside the
  // paragraph, which stretched the line holding it. Swedish wraps to two
  // lines, so it is the case that showed the gap.
  for (const [locale, dict] of [["en", en], ["sv", sv]] as const) {
    test(`the ${locale} message keeps tight lines and both controls are tappable`, async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: LOCALE_COOKIE, value: locale, url: baseURL! }]);
      await page.goto("/signup");
      const region = notice(page);
      await expect(region).toBeVisible();
      const para = region.locator("p");
      const { height, lineHeight } = await para.evaluate((el) => ({
        height: el.getBoundingClientRect().height,
        lineHeight: parseFloat(getComputedStyle(el).lineHeight),
      }));
      expect(height).toBeLessThan(3 * lineHeight);
      for (const target of [
        region.getByRole("link", { name: dict.cookieNotice.learnMore }),
        region.getByRole("button", { name: dict.cookieNotice.dismiss }),
      ]) {
        const box = (await target.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(43.5);
        expect(box.width).toBeGreaterThanOrEqual(43.5);
      }
    });
  }

  test("signup's submit button stays visible under the notice", async ({ page }) => {
    await page.goto("/signup");
    await expect(notice(page)).toBeVisible();
    const submit = page.getByRole("button", { name: en.auth.signup.submit });
    await expectClearOfNotice(page, submit);
    await expect(submit).toBeInViewport({ ratio: 1 });
  });

  test("the footer language toggle can be tapped without dismissing the notice", async ({ page }) => {
    await page.goto("/login");
    await expect(notice(page)).toBeVisible();
    const toggle = page.getByRole("button", { name: new RegExp(en.language.toggleLabel) });
    await expectClearOfNotice(page, toggle);
    // Playwright refuses to click a control something else is covering.
    await toggle.click();
    await expect(page.getByRole("region", { name: /Information om cookies/ })).toBeVisible();
  });
});

test("the dashboard's floating primary action clears the notice", async ({ page, context }) => {
  // The logged-in storage state carries no acknowledgement cookie; be sure.
  await context.clearCookies({ name: COOKIE_NOTICE_COOKIE });
  await page.goto("/dashboard/tasks");
  await expect(notice(page)).toBeVisible();
  const add = page.getByRole("button", { name: "Add task" });
  await expectClearOfNotice(page, add);
  await expect(add).toBeInViewport({ ratio: 1 });
  // The shell is h-dvh with a scrolling column: room for the notice is made
  // inside it, so the document itself must not grow (it did when body
  // padding was applied here too).
  const overflow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  expect(overflow).toBeLessThanOrEqual(0);
});
