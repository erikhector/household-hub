import { expect, test, type Page } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { E2E_SHOPPING_LIST } from "./seed-data";
import { clickRowAction, dismissCookieNotice, expectHydrated, clickListSetting } from "./ui";

// PERF-25: the list page's dialogs are separate chunks, mounted the first time
// they're asked to open. The first tap after a hard load must still open one
// at once, whether its chunk was prefetched in idle time or not.
const t = en.shoppingList;
const listUrl = `/dashboard/shopping-list/${E2E_SHOPPING_LIST.id}`;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

async function openMoreMenu(page: Page) {
  const more = page.getByRole("button", { name: t.moreActions });
  await expectHydrated(more);
  await more.click();
}

test("a menu dialog opens on the first tap after a hard load", async ({ page }) => {
  await page.goto(listUrl);
  await openMoreMenu(page);
  await clickListSetting(page, t.addItem, t.menuListSettings);
  await expect(page.getByRole("dialog", { name: t.addItemDialogTitle })).toBeVisible();
});

test("a row's edit dialog opens on the first tap after a hard load", async ({ page }) => {
  await page.goto(listUrl);
  await expectHydrated(page.getByRole("button", { name: t.moreActions }));
  await clickRowAction(page, { button: "Edit Apples", menu: "More actions for Apples", item: "Edit" });
  await expect(page.getByRole("dialog", { name: /^Edit "Apples"/ })).toBeVisible();
});

test("a dialog still opens when idle prefetching never ran", async ({ page }) => {
  // The tap has to fetch the chunk itself and open once it arrives.
  await page.addInitScript(() => {
    window.requestIdleCallback = () => 0;
  });
  await page.goto(listUrl);
  await openMoreMenu(page);
  await clickListSetting(page, t.renameList.menuItem, t.menuListSettings);
  await expect(page.getByRole("textbox", { name: t.renameList.nameLabel })).toBeVisible();
  // Closing and opening again goes through the already mounted dialog.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("textbox", { name: t.renameList.nameLabel })).toBeHidden();
  await openMoreMenu(page);
  await clickListSetting(page, t.renameList.menuItem, t.menuListSettings);
  await expect(page.getByRole("textbox", { name: t.renameList.nameLabel })).toBeVisible();
});

test.describe("a failed chunk load", () => {
  // No service worker: it would fetch the chunk past page.route() and no
  // error would ever show (see meal-planning-lazy-dialogs.spec.ts, #766).
  test.use({ serviceWorkers: "block" });

  test("a failed chunk load says so, and the next tap retries", async ({ page }) => {
    await page.addInitScript(() => {
      window.requestIdleCallback = () => 0;
    });
    await page.goto(listUrl);
    const scan = page.getByRole("button", { name: t.receiptScan.scanButton });
    await expectHydrated(scan);

    // Offline (or a chunk replaced by a deploy): every script fetched from now on fails.
    let offline = true;
    await page.route("**/_next/static/**/*.js", (route) => (offline ? route.abort() : route.continue()));
    await scan.click();
    await expect(page.getByText(en.errors.generic)).toBeVisible();
    await expect(scan).toBeVisible();
    await expect(page.getByRole("menuitem", { name: t.receiptScan.takePhoto })).toBeHidden();

    offline = false;
    await scan.click();
    await expect(page.getByRole("menuitem", { name: t.receiptScan.takePhoto })).toBeVisible();
  });
});

test("the receipt scan button opens its menu on the first tap", async ({ page }) => {
  await page.addInitScript(() => {
    window.requestIdleCallback = () => 0;
  });
  await page.goto(listUrl);
  const scan = page.getByRole("button", { name: t.receiptScan.scanButton });
  await expectHydrated(scan);
  await scan.click();
  await expect(page.getByRole("menuitem", { name: t.receiptScan.takePhoto })).toBeVisible();
});
