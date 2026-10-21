import { expect, test } from "@playwright/test";

// UX-126: typing a name that matches an existing item ("Banan" next to
// "Bananer") warns in the Add dialog and offers to add the amount to the
// existing item instead of creating a second one.
test("the add dialog warns about a duplicate and adds to the existing item", async ({ page }) => {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const base = `${id} wobblebanan`;
  await page.goto("/dashboard/inventory");
  const main = page.getByRole("main");
  const addItem = main.getByRole("button", { name: "Add item", exact: true }).filter({ visible: true });

  // The existing item: 500 of the default unit (pcs).
  await addItem.click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(base);
  await dialog.getByLabel("Quantity").fill("500");
  await dialog.getByRole("button", { name: "Add item", exact: true }).click();
  await expect(dialog).toBeHidden();

  // A different spelling of it: a warning, with the stock.
  await addItem.click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(`${id} Wobblebananer`);
  const warning = dialog.getByRole("status").filter({ hasText: "already in your pantry" });
  await expect(warning).toContainText(`${base} is already in your pantry (500 pcs).`);

  // An unrelated name clears it.
  await dialog.getByLabel("Name").fill(`${id} zzunrelated`);
  await expect(warning).toBeHidden();
  await dialog.getByLabel("Name").fill(`${id} Wobblebananer`);

  // A unit that doesn't convert to the item's (kg vs pcs): no button, a note
  // saying the units differ, so the amount is never added in the wrong unit.
  const unit = dialog.getByLabel("Unit", { exact: true });
  await unit.fill("kg");
  await dialog.getByText("Category", { exact: true }).click();
  await expect(warning.getByRole("button", { name: "Add to existing" })).toBeHidden();
  await expect(warning).toContainText("is kept in pcs, which kg doesn't convert to");
  await unit.fill("pcs");
  await dialog.getByText("Category", { exact: true }).click();
  await expect(warning.getByRole("button", { name: "Add to existing" })).toBeVisible();

  // "I bought more": the form's quantity goes onto the existing item.
  await dialog.getByLabel("Quantity").fill("250");
  await warning.getByRole("button", { name: "Add to existing" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`Added 250 pcs to ${base}`)).toBeVisible();

  await page.reload();
  await page.getByPlaceholder("Search by name…").filter({ visible: true }).fill(base);
  const row = main.getByText(base, { exact: true }).filter({ visible: true });
  await expect(row).toHaveCount(1);
  await expect(main.getByText("750 pcs").filter({ visible: true }).first()).toBeVisible();
});
