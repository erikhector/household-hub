import { expect, test, type Page } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { createHouseholdMenuTrigger, dismissCookieNotice, expectHydrated, gotoRevealed } from "./ui";

// PERF-27: the dashboard shell's popups (command palette, household switcher
// menu and create form) are separate chunks, mounted the first time they're
// asked to open. The first press or tap after a hard load must still open one
// at once, whether its chunk was prefetched in idle time or not.
const SHORTCUT = "ControlOrMeta+k";
const switcher = en.household.switcher;

test.beforeEach(async ({ context, baseURL, page }) => {
  await dismissCookieNotice(context, baseURL!);
  // Idle prefetching never runs, so every open has to fetch its own chunk.
  await page.addInitScript(() => {
    window.requestIdleCallback = () => 0;
  });
});

// The listener attaches on hydration, which a press right after goto can
// beat; press again only while the palette isn't up so a slow hydration
// doesn't toggle it open and shut.
async function openPalette(page: Page) {
  const palette = page.getByRole("dialog", { name: en.commandPalette.title });
  await expect(async () => {
    if (!(await palette.isVisible())) await page.keyboard.press(SHORTCUT);
    await expect(palette).toBeVisible({ timeout: 1000 });
  }).toPass();
  return palette;
}

// UX-158: on a phone the seeded single-household user has no switcher, so
// the menu with "Create household" is the bottom bar's More menu (also lazy).
function switcherButton(page: Page, isMobile: boolean) {
  return createHouseholdMenuTrigger(page, isMobile, en.nav.more);
}

test("the palette opens on the first shortcut press without the idle prefetch", async ({ page }) => {
  await gotoRevealed(page, "/dashboard");
  const palette = await openPalette(page);
  await expect(palette.getByRole("combobox", { name: en.commandPalette.inputLabel })).toBeFocused();
  // Closing and opening again goes through the already mounted dialog, blank.
  await palette.getByRole("combobox").fill("budget");
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await page.keyboard.press(SHORTCUT);
  await expect(palette).toBeVisible();
  await expect(palette.getByRole("combobox")).toHaveValue("");
});

test("the household switcher opens its menu on the first tap, and the create form from it", async ({ page, isMobile }) => {
  await page.goto("/dashboard");
  const trigger = switcherButton(page, isMobile);
  await expectHydrated(trigger);
  await trigger.click();
  await expect(page.getByRole("menuitem", { name: switcher.createMenuItem })).toBeVisible();
  await page.getByRole("menuitem", { name: switcher.createMenuItem }).click();
  await expect(page.getByRole("dialog", { name: switcher.createNew })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: switcher.createNew })).toBeHidden();
  // The real trigger is mounted now and opens the menu again.
  await switcherButton(page, isMobile).click();
  await expect(page.getByRole("menuitem", { name: switcher.createMenuItem })).toBeVisible();
});

test.describe("a failed chunk load", () => {
  // No service worker: it would fetch the chunk past page.route() and no
  // error would ever show (see meal-planning-lazy-dialogs.spec.ts, #766).
  test.use({ serviceWorkers: "block" });

  test("the palette says so, and the next press retries", async ({ page, isMobile }) => {
    await gotoRevealed(page, "/dashboard");
    await expectHydrated(switcherButton(page, isMobile));
    let offline = true;
    await page.route("**/_next/static/**/*.js", (route) => (offline ? route.abort() : route.continue()));
    await page.keyboard.press(SHORTCUT);
    await expect(page.getByText(en.errors.generic)).toBeVisible();
    await expect(page.getByRole("dialog", { name: en.commandPalette.title })).toBeHidden();

    offline = false;
    await openPalette(page);
  });

  test("the switcher says so, and the next tap retries", async ({ page, isMobile }) => {
    await page.goto("/dashboard");
    const trigger = switcherButton(page, isMobile);
    await expectHydrated(trigger);
    let offline = true;
    await page.route("**/_next/static/**/*.js", (route) => (offline ? route.abort() : route.continue()));
    await trigger.click();
    await expect(page.getByText(en.errors.generic)).toBeVisible();
    await expect(trigger).toBeVisible();
    await expect(page.getByRole("menuitem", { name: switcher.createMenuItem })).toBeHidden();

    offline = false;
    // On a phone the error toast sits over the header's switcher and
    // swallows a real click, so the retry is dispatched to the button.
    await trigger.dispatchEvent("click");
    await expect(page.getByRole("menuitem", { name: switcher.createMenuItem })).toBeVisible();
  });
});
