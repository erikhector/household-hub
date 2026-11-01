import { expect, test } from "@playwright/test";
import { expectHydrated } from "./ui";

// UX-156: a first-timer's first item, saved with the form's defaults
// (quantity 1, "Running low below" pre-filled for a piece count), must read
// "In stock". The rule is strict (quantity < threshold), so a default above
// the default quantity would badge it "Low stock" on arrival.
test("an item added with the default quantity is not badged Low stock", async ({ page }) => {
  const name = `Olive oil ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  await page.goto("/dashboard/inventory");
  const main = page.getByRole("main");

  const addItem = main.getByRole("button", { name: "Add item", exact: true }).filter({ visible: true });
  await expectHydrated(addItem);
  await addItem.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(name);
  await expect(dialog.getByLabel("Quantity")).toHaveValue("1");
  await dialog.getByRole("button", { name: "Add item", exact: true }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  await page.getByPlaceholder("Search by name…").filter({ visible: true }).fill(name);
  await expect(main.getByText(name, { exact: true }).filter({ visible: true })).toHaveCount(1);
  // The search leaves only this item, so any "Low stock" badge left in the
  // list would be its own.
  await expect(main.getByText("Low stock", { exact: true }).filter({ visible: true })).toHaveCount(0);
});
