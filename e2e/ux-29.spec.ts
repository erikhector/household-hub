import { expect, test, type Page } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { collectErrors, dismissCookieNotice } from "./ui";

// UX-29 (platform polish): document-level and card-level guards. Anything
// needing no account runs logged out on /login; the install/push cards run
// signed in on /dashboard/profile with a spoofed navigator, since CI has no
// iPhone (and Playwright's Chromium reports a desktop UA everywhere).

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1";
// What an iPad reports with "Request Desktop Website" (the default since
// iPadOS 13): a Mac UA, but with touch.
const IPAD_DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

async function spoofNavigator(
  page: Page,
  identity: { userAgent: string; platform: string; maxTouchPoints: number },
) {
  await page.addInitScript((spoof) => {
    // Own instance properties shadowing Navigator.prototype's getters.
    Object.defineProperty(window.navigator, "userAgent", { value: spoof.userAgent, configurable: true });
    Object.defineProperty(window.navigator, "platform", { value: spoof.platform, configurable: true });
    Object.defineProperty(window.navigator, "maxTouchPoints", {
      value: spoof.maxTouchPoints,
      configurable: true,
    });
  }, identity);
}

function transitionSeconds(value: string): number[] {
  return value
    .split(",")
    .map((part) => parseFloat(part))
    .filter((n) => !Number.isNaN(n));
}

test.describe("document polish", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("theme-color tracks the colour scheme", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/login");
    const colors = await page.evaluate(() =>
      Array.from(document.querySelectorAll('meta[name="theme-color"]')).map((meta) => ({
        media: meta.getAttribute("media"),
        color: (meta as HTMLMetaElement).content,
      })),
    );
    expect(colors).toEqual([
      { media: "(prefers-color-scheme: light)", color: "#fefcff" },
      { media: "(prefers-color-scheme: dark)", color: "#0a0414" },
    ]);
    expect(errors).toEqual([]);
  });

  test("taps leave no platform highlight", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/login");
    // active: states already answer every touch (DESIGN.md M5).
    const highlight = await page.evaluate(() =>
      getComputedStyle(document.body).getPropertyValue("-webkit-tap-highlight-color"),
    );
    expect(highlight).toBe("rgba(0, 0, 0, 0)");
    expect(errors).toEqual([]);
  });

  test("reduced motion collapses transitions", async ({ page }) => {
    const errors = collectErrors(page);
    // The login submit is a Button, which always carries transition-all
    // (0.15s), so this measures a real transition, not a vacuous 0s.
    await page.goto("/login");
    const submit = page.getByRole("button").first();
    await expect(submit).toBeVisible();
    const normal = await submit.evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(Math.max(...transitionSeconds(normal))).toBeGreaterThanOrEqual(0.1);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await expect(submit).toBeVisible();
    const reduced = await submit.evaluate((el) => getComputedStyle(el).transitionDuration);
    for (const seconds of transitionSeconds(reduced)) expect(seconds).toBeLessThan(0.01);
    expect(errors).toEqual([]);
  });

  test("an outdated browser gets the update notice, a modern one nothing", async ({ page }) => {
    const errors = collectErrors(page);
    await page.addInitScript(() => {
      Object.defineProperty(window, "CSS", { value: { supports: () => false }, configurable: true });
    });
    await page.goto("/login");
    const notice = page.getByRole("region", { name: en.browserFloor.title });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(en.browserFloor.message);
    expect(errors).toEqual([]);
  });

  test("a modern browser gets no floor notice", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/login");
    await expect(page.getByRole("region", { name: en.browserFloor.title })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe("profile cards on Apple-mobile browsers", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await dismissCookieNotice(context, baseURL!);
  });

  test("an iPad with a desktop UA gets the iOS install steps", async ({ page }) => {
    const errors = collectErrors(page);
    await spoofNavigator(page, { userAgent: IPAD_DESKTOP_UA, platform: "MacIntel", maxTouchPoints: 5 });
    await page.goto("/dashboard/profile");
    await expect(page.getByText(en.profile.installApp.iosDescription)).toBeVisible();
    await expect(page.getByText(en.profile.installApp.genericDescription)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("iOS outside the installed app is told to use the Home Screen, never that push is unsupported", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await spoofNavigator(page, { userAgent: IPHONE_UA, platform: "iPhone", maxTouchPoints: 5 });
    // Headless-shell Chromium hardcodes Notification.permission to "denied"
    // and ignores permission grants; a real iPhone reports default/granted
    // here, which is the state this branch is about.
    await page.addInitScript(() => {
      Object.defineProperty(window.Notification, "permission", { value: "granted", configurable: true });
    });
    await page.goto("/dashboard/profile");
    await expect(page.getByRole("heading", { name: en.profile.pushNotifications.title })).toBeVisible();
    await expect(page.getByText(en.profile.pushNotifications.unsupported)).toHaveCount(0);
    // Without VAPID keys (e.g. CI) the card reports that instead — the
    // install prompt only shows where push is actually configured. The full
    // branch matrix (ios-install vs available vs unsupported, all UA shapes)
    // is covered in unit tests instead — see pushAvailability in
    // src/lib/platform.test.ts — since no test browser is an iPhone; this
    // spec guards the one thing only the real card can prove: an iOS 16.4+
    // browser never sees the "not supported" copy.
    const body = await page.locator("main").innerText();
    if (!body.includes(en.profile.pushNotifications.notConfigured)) {
      await expect(page.getByText(en.profile.pushNotifications.iosInstallRequired)).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
});
