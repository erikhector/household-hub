import { expect, test, type Page } from "@playwright/test";
import { budgetTag, insertHouseholdCategory, withDb } from "./budget-seed";
import { STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { dismissCookieNotice, expectHydrated, expectRouterPatched, LOCALES } from "./ui";

// UX-183b: the budget's add dialogs (transaction, recurring item, planned
// bill) word a missing name, amount or date under the field in the page's
// language (role="alert") instead of the browser's own bubble. Focus moves to
// the first empty field, it gets aria-invalid, and what was typed elsewhere
// stays.
const T = {
  en: {
    addTransaction: "Add transaction",
    amount: "Amount",
    date: "Date",
    description: "Description",
    noAmount: "Enter an amount",
    noDate: "Enter a date",
    noName: "Enter a name",
    region: "Bills & income",
    add: "Add",
    recurringMenu: "Repeats every month or year",
    billMenu: "One-off bill",
    recurringTitle: "Add recurring item",
    recurringSubmit: "Add item",
    recurringName: "Name",
    recurringAmount: "Expected amount",
    billTitle: "Add planned bill",
    billSubmit: "Save",
    billName: "Name",
    billAmount: "Amount",
    billDue: "Due date",
  },
  sv: {
    addTransaction: "Lägg till transaktion",
    amount: "Belopp",
    date: "Datum",
    description: "Beskrivning",
    noAmount: "Ange ett belopp",
    noDate: "Ange ett datum",
    noName: "Ange ett namn",
    region: "Räkningar & inkomster",
    add: "Lägg till",
    recurringMenu: "Återkommer varje månad eller år",
    billMenu: "Engångsräkning",
    recurringTitle: "Lägg till återkommande post",
    recurringSubmit: "Lägg till post",
    recurringName: "Namn",
    recurringAmount: "Förväntat belopp",
    billTitle: "Lägg till planerad räkning",
    billSubmit: "Spara",
    billName: "Namn",
    billAmount: "Belopp",
    billDue: "Förfallodatum",
  },
} as const;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

async function seedCategory() {
  const tag = budgetTag();
  await withDb((client) => insertHouseholdCategory(client, { id: `e2e-bfe-cat-${tag}`, name: `Food ${tag}` }));
}

async function openAddMenu(page: Page, t: (typeof T)[keyof typeof T], item: string) {
  await page.goto("/dashboard/budget?tab=manage");
  const add = page.getByRole("main").getByRole("region", { name: t.region }).getByRole("button", { name: t.add, exact: true });
  await expectHydrated(add);
  await expectRouterPatched(page);
  await add.click();
  await page.getByRole("menuitem", { name: item }).click();
}

for (const locale of LOCALES) {
  test.describe(`budget dialog field errors (${locale})`, () => {
    test.use({ storageState: locale === "sv" ? STORAGE_STATE_SV : STORAGE_STATE });
    const t = T[locale];

    test("an empty amount and date in Add transaction are flagged under their fields", async ({ page }) => {
      await seedCategory();
      await page.goto("/dashboard/budget");
      const opener = page.getByRole("button", { name: t.addTransaction }).first();
      await expectHydrated(opener);
      await opener.click();
      const dialog = page.getByRole("dialog", { name: t.addTransaction });
      const submit = dialog.getByRole("button", { name: t.addTransaction, exact: true });

      await dialog.getByLabel(t.description).fill("Kept note");
      await dialog.getByLabel(t.date, { exact: true }).fill("");
      await submit.click();
      const amount = dialog.getByLabel(t.amount, { exact: true });
      await expect(dialog.getByRole("alert").filter({ hasText: t.noAmount })).toBeVisible();
      await expect(dialog.getByRole("alert").filter({ hasText: t.noDate })).toBeVisible();
      await expect(amount).toHaveAttribute("aria-invalid", "true");
      await expect(amount).toBeFocused();
      // The blocked submit didn't reset the form, and the dialog stays open.
      await expect(dialog.getByLabel(t.description)).toHaveValue("Kept note");

      await amount.fill("12");
      await expect(dialog.getByRole("alert").filter({ hasText: t.noAmount })).toHaveCount(0);
      await expect(dialog.getByRole("alert").filter({ hasText: t.noDate })).toBeVisible();
    });

    test("an empty name and amount in Add recurring item are flagged under their fields", async ({ page }) => {
      await seedCategory();
      await openAddMenu(page, t, t.recurringMenu);
      const dialog = page.getByRole("dialog", { name: t.recurringTitle });
      await dialog.getByRole("button", { name: t.recurringSubmit }).click();
      const name = dialog.getByLabel(t.recurringName, { exact: true });
      await expect(dialog.getByRole("alert").filter({ hasText: t.noName })).toBeVisible();
      await expect(dialog.getByRole("alert").filter({ hasText: t.noAmount })).toBeVisible();
      await expect(name).toHaveAttribute("aria-invalid", "true");
      await expect(name).toBeFocused();

      await name.fill("Rent");
      await expect(dialog.getByRole("alert").filter({ hasText: t.noName })).toHaveCount(0);
      await dialog.getByRole("button", { name: t.recurringSubmit }).click();
      const amount = dialog.getByLabel(t.recurringAmount);
      await expect(amount).toBeFocused();
      await expect(amount).toHaveAttribute("aria-invalid", "true");
      await expect(name).toHaveValue("Rent");
    });

    test("an empty name, amount and due date in Add planned bill are flagged under their fields", async ({ page }) => {
      await seedCategory();
      await openAddMenu(page, t, t.billMenu);
      const dialog = page.getByRole("dialog", { name: t.billTitle });
      await dialog.getByLabel(t.billDue).fill("");
      await dialog.getByRole("button", { name: t.billSubmit }).click();
      const name = dialog.getByLabel(t.billName, { exact: true });
      await expect(dialog.getByRole("alert").filter({ hasText: t.noName })).toBeVisible();
      await expect(dialog.getByRole("alert").filter({ hasText: t.noAmount })).toBeVisible();
      await expect(dialog.getByRole("alert").filter({ hasText: t.noDate })).toBeVisible();
      await expect(name).toHaveAttribute("aria-invalid", "true");
      await expect(name).toBeFocused();
    });
  });
}
