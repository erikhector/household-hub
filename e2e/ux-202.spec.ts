import { expect, test } from "@playwright/test";
import { withDb } from "./db";
import { E2E_HOUSEHOLD, STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow, LOCALES } from "./ui";

// UX-202: an invalid estimated price on a shopping row is flagged under the
// field, in the app's language, with what was typed kept, instead of the
// browser's own validation bubble (in the browser's language) or a toast
// that lands behind the Next up dock on a phone. Lists are written straight
// to Postgres, named uniquely and removed again (only this worker's
// household's rows).
const tag = () => `${Date.now().toString(36)}-w${E2E_WORKER}`;

async function sql(text: string, values: unknown[] = []) {
  await withDb(async (client) => {
    await client.query(text, values);
  });
}

async function seedRow(t: string) {
  const listId = `e2e-ux202-list-${t}`;
  const name = `Oat milk ${t}`;
  await sql(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, $3)`, [
    listId,
    E2E_HOUSEHOLD.id,
    `Price check ${t}`,
  ]);
  await sql(
    `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "updatedAt")
     VALUES ($1, $2, $3, $4, 0, 'pcs', now())`,
    [`e2e-ux202-inv-${t}`, E2E_HOUSEHOLD.id, name, `Aisle ${t}`],
  );
  await sql(
    `INSERT INTO "ShoppingListItem" (id, "shoppingListId", name, unit, purchased, "inventoryItemId")
     VALUES ($1, $2, $3, 'pcs', false, $4)`,
    [`e2e-ux202-item-${t}`, listId, name, `e2e-ux202-inv-${t}`],
  );
  return { path: `/dashboard/shopping-list/${listId}`, name };
}

const T = {
  en: {
    addAria: "Add an estimated price for {name}",
    more: "More actions for {name}",
    addPrice: "Add price",
    input: "Estimated price for {name}",
    editAria: "Edit estimated price for {name}",
    invalid: "Enter a valid price",
  },
  sv: {
    addAria: "Lägg till ett uppskattat pris för {name}",
    more: "Fler åtgärder för {name}",
    addPrice: "Lägg till pris",
    input: "Uppskattat pris för {name}",
    editAria: "Redigera uppskattat pris för {name}",
    invalid: "Ange ett giltigt pris",
  },
};

test.afterAll(async () => {
  for (const table of ["ShoppingList", "InventoryItem"]) {
    await sql(`DELETE FROM "${table}" WHERE id LIKE 'e2e-ux202-%' AND "householdId" = $1`, [E2E_HOUSEHOLD.id]);
  }
});

for (const locale of LOCALES) {
  test.describe(`inline price error (${locale})`, () => {
    // Signed in, the language comes from the account, so each locale runs
    // as its own seeded user (e2e/seed.ts).
    test.use({ storageState: locale === "sv" ? STORAGE_STATE_SV : STORAGE_STATE });
    test.beforeEach(async ({ context, baseURL }) => {
      await dismissCookieNotice(context, baseURL!);
    });
    const t = T[locale];
    const label = (s: string, name: string) => s.replace("{name}", name);

    test("a negative price is flagged under the field, kept, and no toast shows", async ({ page }) => {
      const { path, name } = await seedRow(tag());
      await page.goto(path);

      // On a phone the row's ⋯ carries "Add price" (UX-79).
      if (page.viewportSize()!.width < 640) {
        const more = page.getByRole("button", { name: label(t.more, name) });
        await expectHydrated(more);
        await more.click();
        await page.getByRole("menuitem", { name: t.addPrice }).click();
      } else {
        const add = page.getByRole("button", { name: label(t.addAria, name) });
        await expectHydrated(add);
        await add.click();
      }

      const input = page.getByRole("textbox", { name: label(t.input, name) });
      await expect(input).toBeFocused();
      await input.fill("-1");
      await input.press("Enter");

      // Kept, flagged and explained in that row, in the app's language.
      const row = page
        .getByRole("checkbox", { name: new RegExp(`^${name}`) })
        .locator("xpath=ancestor::*[@data-swipe-row][1]");
      await expect(input).toHaveValue("-1");
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await expect(row.getByRole("alert")).toHaveText(t.invalid);
      await expect(input).toHaveAccessibleDescription(t.invalid);
      // Only the inline message: no toast repeating it.
      await expect(page.getByText(t.invalid)).toHaveCount(1);
      await expectNoHorizontalOverflow(page);

      // Fixing it clears the flag and saves.
      await input.fill("12");
      await expect(input).not.toHaveAttribute("aria-invalid", "true");
      await expect(row.getByRole("alert")).toHaveCount(0);
      await input.press("Enter");
      await expect(input).toBeHidden();
      await expect(page.getByRole("button", { name: label(t.editAria, name) })).toContainText("12");
    });
  });
}
