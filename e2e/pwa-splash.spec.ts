import { expect, test, type Page } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { dismissCookieNotice, expectHydrated } from "./ui";

// The installed app's launch splash (PwaSplashScreen, `.pwa-splash-*` in
// globals.css). It only exists under `display-mode: standalone`, which
// Playwright can't launch a page in (and Chromium's media emulation doesn't
// cover), so an "installed launch" here serves the app's CSS with that
// condition rewritten to `all`: from the first paint the page then renders
// exactly as the installed app would. The service worker is blocked so the
// stylesheet always comes through the route, never from its cache.
//
// The splash is decorative and aria-hidden, so it has no role or name to
// find it by: its class is the only handle.
test.use({ serviceWorkers: "block" });

async function launchInstalled(page: Page) {
  await page.route(/\/_next\/static\/.+\.css(\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(/\(\s*display-mode\s*:\s*standalone\s*\)/g, "all");
    await route.fulfill({ response, body });
  });
}

/** The keyframes every animation on the splash and its children ran, finished
 * ones included (they all hold their end state, so they stay listed). */
function splashAnimations(page: Page) {
  return page.locator(".pwa-splash-screen").evaluate((splash) =>
    splash.getAnimations({ subtree: true }).map((animation) => (animation as CSSAnimation).animationName),
  );
}

const splashVisibility = (page: Page) =>
  page.locator(".pwa-splash-screen").evaluate((splash) => getComputedStyle(splash).visibility);

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("in a browser tab the launch splash never shows", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.locator(".pwa-splash-screen")).toBeHidden();
  expect(await splashAnimations(page)).toEqual([]);
});

test("an installed launch hops the badge in, then opens onto the app", async ({ page }) => {
  await launchInstalled(page);
  await page.goto("/dashboard");

  await expect.poll(() => splashVisibility(page)).toBe("hidden");
  expect(await splashAnimations(page)).toEqual(
    expect.arrayContaining([
      "pwa-splash-intro-hop",
      "pwa-splash-intro-rise",
      "pwa-splash-exit-iris",
      "pwa-splash-exit-mark",
    ]),
  );

  // Gone means out of the way: the app underneath takes taps.
  const inventory = page.getByRole("navigation").getByRole("link", { name: en.nav.inventory, exact: true });
  await expectHydrated(inventory);
  await inventory.click();
  await expect(page).toHaveURL(/\/dashboard\/inventory$/);
});

test("with reduced motion an installed launch has no intro and still leaves", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await launchInstalled(page);
  await page.goto("/dashboard");

  await expect.poll(() => splashVisibility(page)).toBe("hidden");
  const names = await splashAnimations(page);
  expect(names.filter((name) => name.startsWith("pwa-splash-intro-"))).toEqual([]);
});
