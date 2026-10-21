import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { clickRowAction, dismissCookieNotice } from "./ui";

// UX-128: the edit form no longer offers a unit change the action will
// refuse. With stock the unit is read-only beside a "Change unit…" link; an
// item with saved conversions but no stock still has an editable unit, and
// its refusal appears under that field, in view, rather than at the foot of
// the scrolling form. Items are written straight to Postgres, one per test.
const PREFIX = "e2e-ux128-";
const suffix = () => `${Date.now().toString(36)}-w${E2E_WORKER}`;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

// Only this household's rows; conversions go with their item (cascade).
test.afterEach(async () => {
  await withClient((client) =>
    client.query(`DELETE FROM "InventoryItem" WHERE "householdId" = $1 AND id LIKE $2`, [E2E_HOUSEHOLD.id, `${PREFIX}%`]),
  );
});

async function seedItem(quantity: number, withConversion: boolean) {
  const tag = suffix();
  const item = { id: `${PREFIX}${tag}`, name: `Butter ${tag}` };
  await withClient(async (client) => {
    await client.query(
      `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "updatedAt")
       VALUES ($1, $2, $3, 'Dairy', $4, 'g', now())`,
      [item.id, E2E_HOUSEHOLD.id, item.name, quantity],
    );
    if (withConversion) {
      await client.query(
        `INSERT INTO "ItemUnitConversion" (id, "inventoryItemId", "fromUnit", factor) VALUES ($1, $2, 'pcs', 250)`,
        [`${item.id}-conv`, item.id],
      );
    }
  });
  return item;
}

async function openEdit(page: import("@playwright/test").Page, id: string) {
  await page.goto(`/dashboard/inventory/items/${id}`);
  await clickRowAction(page, { button: "Edit item", menu: "More actions", item: "Edit" });
  return page.getByRole("dialog", { name: "Edit inventory item" });
}

test("an item with stock shows its unit read-only with a Change unit link", async ({ page }) => {
  const item = await seedItem(3, false);
  const dialog = await openEdit(page, item.id);

  await expect(dialog.getByRole("textbox", { name: "Unit" })).toHaveJSProperty("readOnly", true);
  const link = dialog.getByRole("link", { name: "Change unit…" });
  await expect(link).toHaveAttribute("href", `/dashboard/inventory/items/${item.id}`);

  // Saving something else still works: the read-only unit posts unchanged.
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
});

test("a refused unit change shows under the unit field, in view", async ({ page }) => {
  const item = await seedItem(0, true);
  const dialog = await openEdit(page, item.id);

  const unit = dialog.getByRole("combobox", { name: "Unit" });
  await expect(unit).toBeEditable();
  await unit.fill("kg");
  // Tab closes the suggestion list, which otherwise hides the dialog's
  // buttons from the accessibility tree.
  await unit.press("Tab");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();

  const refusal = dialog.getByRole("alert").filter({ hasText: "Change unit" });
  await expect(refusal).toBeVisible();
  await expect(refusal).toBeInViewport({ ratio: 1 });
  await expect(dialog.getByRole("link", { name: "Change unit…" })).toBeVisible();
  // Directly under the field and above the rest of the form, not the
  // form-level message at the foot (which would sit below Save's row).
  const unitBox = (await unit.boundingBox())!;
  const refusalBox = (await refusal.boundingBox())!;
  const expiryBox = (await dialog.getByLabel("Expires on").boundingBox())!;
  expect(refusalBox.y).toBeGreaterThanOrEqual(unitBox.y + unitBox.height);
  expect(refusalBox.y + refusalBox.height).toBeLessThanOrEqual(expiryBox.y);
});
