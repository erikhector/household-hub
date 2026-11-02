import { expect, test, type Page } from "@playwright/test";
import { clickRowAction, dismissCookieNotice, waitForUndoableDelete } from "./ui";

// UX-89: a free-text item typed onto a list makes a pantry item at 0 that
// was never stocked. It isn't "out" (nothing was ever in), and deleting the
// row that made it takes the item with it. The household holds other specs'
// rows, so the test names its own item and checks only that one.
const unique = (label: string) => `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

async function inventoryRow(page: Page, url: string, name: string) {
  await page.goto(url);
  const search = page.getByRole("searchbox").filter({ visible: true });
  await expect(search).toHaveCount(1);
  await search.fill(name);
  return page.getByRole("main").getByText(name, { exact: true });
}

test("a typed list item is not out of stock, and deleting its row removes the item", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  const listName = unique("Never stocked list");
  const item = unique("Napkins");

  await page.goto("/dashboard/shopping-list");
  await page.getByRole("button", { name: "New list" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(listName);
  await page.getByRole("button", { name: "Create list" }).click();
  await expect(page).toHaveURL(/\/dashboard\/shopping-list\/[^/]+$/);
  const listUrl = page.url();

  const addBox = page.getByRole("combobox", { name: "Add to the list" });
  await addBox.fill(item);
  await addBox.press("Enter");
  await expect(page.getByRole("checkbox", { name: new RegExp(`^${item}\\b`) })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: new RegExp(`^${item}\\b`) })).toBeVisible();

  // The pantry item exists, at 0, but the "out" filter doesn't list it.
  await expect(await inventoryRow(page, "/dashboard/inventory", item)).toBeVisible();
  await expect(await inventoryRow(page, "/dashboard/inventory?status=out", item)).toHaveCount(0);

  // Deleting the row removes the item it created.
  await page.goto(listUrl);
  await clickRowAction(page, { button: `Remove ${item}`, menu: `More actions for ${item}`, item: "Delete" });
  await waitForUndoableDelete(page, `Deleted "${item}"`);
  await expect(await inventoryRow(page, "/dashboard/inventory", item)).toHaveCount(0);
});
