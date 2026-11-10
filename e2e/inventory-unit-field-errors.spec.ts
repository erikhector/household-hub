import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD, STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectHydrated, LOCALES } from "./ui";

// UX-183b (inventory): the item page's Change unit and Add conversion dialogs
// word a missing unit or amount under the field in the page's language
// (role="alert"), instead of the browser's own bubble. Focus moves to the
// field, aria-invalid is set and what was typed elsewhere stays.
const MESSAGES = {
  en: {
    changeUnit: "Change unit…",
    changeTitle: "Change unit",
    newUnit: "New unit",
    factor: /^How many g is 1 /,
    noUnit: "Enter the new unit.",
    noFactor: "Enter how many of the new unit one of the old unit is.",
    units: "Units",
    addConversion: "Add conversion",
    unit: "Unit",
    amount: "Amount",
    save: "Save",
    noConvUnit: "Enter a unit.",
    noAmount: "Enter an amount.",
  },
  sv: {
    changeUnit: "Byt enhet…",
    changeTitle: "Byt enhet",
    newUnit: "Ny enhet",
    factor: /^Hur många g är 1 /,
    noUnit: "Ange den nya enheten.",
    noFactor: "Ange hur många av den nya enheten en av den gamla är.",
    units: "Enheter",
    addConversion: "Lägg till omvandling",
    unit: "Enhet",
    amount: "Mängd",
    save: "Spara",
    noConvUnit: "Ange en enhet.",
    noAmount: "Ange en mängd.",
  },
} as const;

async function seedItem(): Promise<string> {
  const id = `e2e-unit-errors-${Date.now().toString(36)}-w${E2E_WORKER}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "lowStockThreshold", "updatedAt")
       VALUES ($1, $2, $3, 'Baking', 1, 'pcs', 0.5, now())`,
      [id, E2E_HOUSEHOLD.id, `Unit errors ${id}`],
    );
  } finally {
    await client.end();
  }
  return id;
}

for (const locale of LOCALES) {
  test.describe(`item page unit field errors (${locale})`, () => {
    test.use({ storageState: locale === "sv" ? STORAGE_STATE_SV : STORAGE_STATE });
    const t = MESSAGES[locale];

    test.beforeEach(async ({ context, baseURL }) => {
      await dismissCookieNotice(context, baseURL!);
    });

    test("Change unit flags an empty unit, then an empty factor", async ({ page }) => {
      await page.goto(`/dashboard/inventory/items/${await seedItem()}`);
      const opener = page.getByRole("button", { name: t.changeUnit });
      await expectHydrated(opener);
      await opener.click();
      const dialog = page.getByRole("dialog", { name: t.changeTitle });
      const submit = dialog.getByRole("button", { name: t.changeTitle, exact: true });

      await submit.click();
      const unit = dialog.getByRole("combobox", { name: t.newUnit });
      await expect(dialog.getByRole("alert").filter({ hasText: t.noUnit })).toBeVisible();
      await expect(dialog.getByRole("alert").filter({ hasText: t.noFactor })).toBeVisible();
      await expect(unit).toHaveAttribute("aria-invalid", "true");
      await expect(unit).toBeFocused();

      // g is not pcs's generic conversion, so no factor is suggested.
      await unit.fill("g");
      // Closes the suggestion popup, which keeps the rest of the dialog inert.
      await unit.press("Tab");
      await expect(dialog.getByRole("alert").filter({ hasText: t.noUnit })).toHaveCount(0);
      await submit.click();
      const factor = dialog.getByRole("textbox", { name: t.factor });
      await expect(dialog.getByRole("alert").filter({ hasText: t.noFactor })).toBeVisible();
      await expect(factor).toHaveAttribute("aria-invalid", "true");
      await expect(factor).toBeFocused();
      await expect(unit).toHaveValue("g");

      await factor.fill("2000");
      await expect(dialog.getByRole("alert").filter({ hasText: t.noFactor })).toHaveCount(0);
    });

    test("Add conversion flags an empty unit, then an empty amount", async ({ page }) => {
      await page.goto(`/dashboard/inventory/items/${await seedItem()}`);
      const summary = page.getByRole("main").getByRole("heading", { name: t.units, level: 2 });
      await expectHydrated(summary);
      await summary.click();
      await page.getByRole("button", { name: t.addConversion }).click();
      const dialog = page.getByRole("dialog", { name: t.addConversion });
      const submit = dialog.getByRole("button", { name: t.save, exact: true });

      await submit.click();
      const unit = dialog.getByRole("combobox", { name: t.unit });
      await expect(dialog.getByRole("alert").filter({ hasText: t.noConvUnit })).toBeVisible();
      await expect(unit).toHaveAttribute("aria-invalid", "true");
      await expect(unit).toBeFocused();

      await unit.fill("cup");
      await unit.press("Tab");
      await expect(dialog.getByRole("alert").filter({ hasText: t.noConvUnit })).toHaveCount(0);
      await submit.click();
      const amount = dialog.getByRole("textbox", { name: t.amount });
      await expect(dialog.getByRole("alert").filter({ hasText: t.noAmount })).toBeVisible();
      await expect(amount).toHaveAttribute("aria-invalid", "true");
      await expect(amount).toBeFocused();
      await expect(unit).toHaveValue("cup");
    });
  });
}
