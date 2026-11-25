import { expect, test } from "@playwright/test";
import { budgetTag, insertHouseholdCategory } from "./budget-seed";
import { unique, withDb } from "./db";
import { E2E_HOUSEHOLD, STORAGE_STATE_SV } from "./seed";
import { dismissCookieNotice, expectHydrated } from "./ui";

// UX-30: a Swedish-region iPhone's decimal keypad has only ",", and WebKit
// submitted "" for "12,5" in a `type="number"` field, so the amount was
// lost. Money and quantity fields are now text fields with the decimal
// keypad, and "12,5" saves as 12.5. As the Swedish member, typing exactly
// what that keypad produces; checked in the database and on the page after
// a reload.

test.use({ storageState: STORAGE_STATE_SV });

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("a budget amount typed as 12,5 saves as 12.5 and reads 12,50", async ({ page }) => {
  const tag = budgetTag();
  const category = `Fika ${tag}`;
  const description = unique("Kanelbulle");
  await withDb((client) => insertHouseholdCategory(client, { id: `e2e-comma-cat-${tag}`, name: category }));

  await page.goto("/dashboard/budget?tab=transactions");
  const opener = page.getByRole("button", { name: "Lägg till transaktion" }).filter({ visible: true }).first();
  await expectHydrated(opener);
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Lägg till transaktion" });

  const amount = dialog.getByLabel("Belopp", { exact: true });
  await expect(amount).toHaveAttribute("type", "text");
  await expect(amount).toHaveAttribute("inputmode", "decimal");
  await amount.fill("12,5");
  await dialog.getByText(category, { exact: true }).click();
  await dialog.getByLabel("Beskrivning").fill(description);
  await dialog.getByRole("button", { name: "Lägg till transaktion" }).click();
  await expect(dialog).toBeHidden();

  const saved = await withDb((client) =>
    client.query<{ amount: string }>(`SELECT amount::text FROM "Transaction" WHERE "householdId" = $1 AND description = $2`, [
      E2E_HOUSEHOLD.id,
      description,
    ]),
  );
  expect(saved.rows.map((row) => Number(row.amount))).toEqual([12.5]);

  await page.reload();
  // The table (desktop) or the compact row (phone): whichever is showing.
  const row = page.getByRole("main").locator("tr, button").filter({ hasText: description }).filter({ visible: true });
  await expect(row.first()).toContainText("12,50");
});

test("an inventory quantity typed as 12,5 saves as 12.5", async ({ page }) => {
  const name = unique("Havregryn");

  await page.goto("/dashboard/inventory");
  const opener = page.getByRole("main").getByRole("button", { name: "Lägg till vara", exact: true }).filter({ visible: true });
  await expectHydrated(opener);
  await opener.click();
  const dialog = page.getByRole("dialog");

  await dialog.getByLabel("Namn", { exact: true }).fill(name);
  const quantity = dialog.getByLabel("Antal");
  await expect(quantity).toHaveAttribute("type", "text");
  await quantity.fill("12,5");
  await dialog.getByRole("button", { name: "Lägg till vara", exact: true }).click();
  await expect(dialog).toBeHidden();

  const saved = await withDb((client) =>
    client.query<{ quantity: number }>(`SELECT quantity FROM "InventoryItem" WHERE "householdId" = $1 AND name = $2`, [
      E2E_HOUSEHOLD.id,
      name,
    ]),
  );
  expect(saved.rows.map((row) => Number(row.quantity))).toEqual([12.5]);

  await page.reload();
  const search = page.getByRole("searchbox").filter({ visible: true });
  await expectHydrated(search);
  await search.fill(name);
  // The inventory shows quantities with formatQuantity, the same on every
  // locale, so 12.5 here; what matters is that 12,5 wasn't lost or read as 125.
  await expect(
    page.getByRole("button", { name: new RegExp(`^Ändra mängden av ${name} \\(12\\.5\\b`) }).filter({ visible: true }),
  ).toBeVisible();
});
