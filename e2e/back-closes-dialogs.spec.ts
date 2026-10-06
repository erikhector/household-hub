import { expect, test } from "@playwright/test";
import { dismissCookieNotice } from "./ui";

// UX-11 (DESIGN.md M7): the browser/OS back gesture closes an open sheet
// instead of leaving the page, and a sheet closed from the UI leaves no
// extra back step behind. Runs on both projects: Android's back button is
// what this is for, but a desktop browser's back button gets the same.

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("back closes the Add item sheet and stays on the page", async ({ page }) => {
  await page.goto("/dashboard");
  await page.goto("/dashboard/inventory");
  await page.getByRole("button", { name: "Add item" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Typed input, to show it's the sheet that goes, not the page under it.
  await dialog.getByLabel("Name").fill("Back gesture test");

  await page.goBack();

  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/dashboard\/inventory$/);
  await expect(page.getByRole("button", { name: "Add item" }).first()).toBeVisible();

  // The next back is a normal one again.
  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("a sheet closed from the UI leaves no extra back step", async ({ page }) => {
  await page.goto("/dashboard");
  await page.goto("/dashboard/inventory");
  await page.getByRole("button", { name: "Add item" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);

  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("a dialog title stays clear of the close button", async ({ page }) => {
  await page.goto("/dashboard/inventory");
  await page.getByRole("button", { name: "Add item" }).first().click();
  const dialog = page.getByRole("dialog");
  const header = await dialog.locator('[data-slot="dialog-header"]').boundingBox();
  const close = await dialog.getByRole("button", { name: "Close" }).boundingBox();
  // The header's content box ends before the close button starts.
  const paddingRight = await dialog
    .locator('[data-slot="dialog-header"]')
    .evaluate((el) => parseFloat(getComputedStyle(el).paddingRight));
  expect(header!.x + header!.width - paddingRight).toBeLessThanOrEqual(close!.x);
});
