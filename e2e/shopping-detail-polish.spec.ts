import { expect, test, type Page } from "@playwright/test";
import { E2E_SHOPPING_LIST } from "./seed-data";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-22: the shopping list detail page. Reads the seeded list (an unlinked
// "Oat milk" and a linked "Wheat flour" in the "Baking" group) without
// changing it, so it is safe next to the other specs.
const LIST_URL = `/dashboard/shopping-list/${E2E_SHOPPING_LIST.id}`;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

async function xOf(page: Page, name: string) {
  const box = await page.getByRole("button", { name, exact: true }).first().boundingBox();
  expect(box, `${name} is on screen`).not.toBeNull();
  return box!.x;
}

test("mic and scan sit inside the add field, only Add outside", async ({ page }) => {
  await page.goto(LIST_URL);
  const field = (await page.getByRole("combobox", { name: "Add to the list" }).boundingBox())!;
  const scan = (await page.getByRole("button", { name: "Scan a barcode to add" }).boundingBox())!;
  expect(scan.x).toBeGreaterThanOrEqual(field.x);
  expect(scan.x + scan.width).toBeLessThanOrEqual(field.x + field.width + 0.5);
  const add = (await page.getByRole("button", { name: "Add", exact: true }).boundingBox())!;
  expect(add.x).toBeGreaterThanOrEqual(field.x + field.width - 0.5);
  await expectNoHorizontalOverflow(page);
});

test("row controls keep one order with delete last, and no chip repeats the group header", async ({ page }) => {
  await page.goto(LIST_URL);

  // Unlinked row: [Match item][price][edit][delete]. On a phone the edit
  // and delete icons give way to one ⋯ (the row's swipe shows both).
  const match = await xOf(page, "Match item");
  const price = await xOf(page, "Add an estimated price for Oat milk");
  expect(match).toBeLessThan(price);
  if (page.viewportSize()!.width < 640) {
    await expect(page.getByRole("button", { name: "Edit Oat milk", exact: true })).toBeHidden();
    await expect(page.getByRole("button", { name: "Remove Oat milk", exact: true })).toBeHidden();
    expect(price).toBeLessThan(await xOf(page, "More actions for Oat milk"));
    return;
  }
  const edit = await xOf(page, "Edit Oat milk");
  const remove = await xOf(page, "Remove Oat milk");
  expect(price).toBeLessThan(edit);
  expect(edit).toBeLessThan(remove);

  // Linked row under its own "Baking" header: no chip, same edit-then-delete tail.
  // (The print-only copy of the list repeats the header, hence :visible.)
  await expect(page.locator("p:visible", { hasText: /^Baking$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Category of Wheat flour/ })).toHaveCount(0);
  expect(await xOf(page, "Edit Wheat flour")).toBeLessThan(await xOf(page, "Remove Wheat flour"));
});

test("Match item is a tinted warning badge with an icon", async ({ page }) => {
  await page.goto(LIST_URL);
  const badge = page.getByRole("button", { name: "Match item" }).first();
  await expect(badge.locator("svg")).toBeVisible();
  await expect(badge).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});

test("the receipt action has the index page's name", async ({ page }) => {
  await page.goto(LIST_URL);
  await expect(page.getByRole("button", { name: "Register receipt" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Scan receipt" })).toHaveCount(0);
});
