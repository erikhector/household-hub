import { expect, test, type Page } from "@playwright/test";
import { budgetTag, insertHouseholdCategory } from "./budget-seed";
import { withDb } from "./db";
import { E2E_HOUSEHOLD, E2E_MEMBER, E2E_MEMBER_SV, E2E_USER, E2E_USER_SV, STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { dismissCookieNotice, expectHydrated, expectRouterPatched, LOCALES } from "./ui";

// UX-183b: the budget's add dialogs (transaction, recurring item, planned
// bill) word a missing name, amount or date under the field in the page's
// language (role="alert") instead of the browser's own bubble. Focus moves to
// the first empty field, it gets aria-invalid, and what was typed elsewhere
// stays. The second slice covers the category add/edit dialogs, Clear debt
// and the personal budget's Log payment (shared bill) dialog.
//
// UX-207: the recurring item and one-off bill dialogs also check Category
// before sending anything, and the recurring item and category dialogs keep
// what was typed when the server turns a save down.
const T = {
  en: {
    addTransaction: "Add transaction",
    amount: "Amount",
    date: "Date",
    description: "Description",
    noAmount: "Enter an amount",
    noDate: "Enter a date",
    noName: "Enter a name",
    noCategory: "Pick a category",
    category: "Category",
    region: "Bills & income",
    add: "Add",
    recurringMenu: "Repeats every month or year",
    billMenu: "One-off bill",
    recurringTitle: "Add recurring item",
    recurringSubmit: "Add item",
    recurringName: "Name",
    recurringAmount: "Expected amount",
    recurringDay: "Due day (optional)",
    billTitle: "Add planned bill",
    billSubmit: "Save",
    billName: "Name",
    billAmount: "Amount",
    billDue: "Due date",
    addCategory: "Add category",
    editCategoryTitle: "Edit category",
    categoryName: "Name",
    categoryLimit: "Monthly limit (optional)",
    nameTaken: "A category with that name already exists",
    save: "Save",
    clearDebt: "Clear debt",
    clearDebtSubmit: "Record repayment",
    clearAmount: "Amount",
    clearDate: "Date",
    logPayment: "Log payment",
    logSubmit: "Log expense",
    logDescription: "Description",
  },
  sv: {
    addTransaction: "Lägg till transaktion",
    amount: "Belopp",
    date: "Datum",
    description: "Beskrivning",
    noAmount: "Ange ett belopp",
    noDate: "Ange ett datum",
    noName: "Ange ett namn",
    noCategory: "Välj en kategori",
    category: "Kategori",
    region: "Räkningar & inkomster",
    add: "Lägg till",
    recurringMenu: "Återkommer varje månad eller år",
    billMenu: "Engångsräkning",
    recurringTitle: "Lägg till återkommande post",
    recurringSubmit: "Lägg till post",
    recurringName: "Namn",
    recurringAmount: "Förväntat belopp",
    recurringDay: "Förfallodag (valfritt)",
    billTitle: "Lägg till planerad räkning",
    billSubmit: "Spara",
    billName: "Namn",
    billAmount: "Belopp",
    billDue: "Förfallodatum",
    addCategory: "Lägg till kategori",
    editCategoryTitle: "Redigera kategori",
    categoryName: "Namn",
    categoryLimit: "Månadsgräns (valfri)",
    nameTaken: "Det finns redan en kategori med det namnet",
    save: "Spara",
    clearDebt: "Reglera skuld",
    clearDebtSubmit: "Registrera återbetalning",
    clearAmount: "Belopp",
    clearDate: "Datum",
    logPayment: "Logga betalning",
    logSubmit: "Registrera utgift",
    logDescription: "Beskrivning",
  },
} as const;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

async function seedCategory() {
  const tag = budgetTag();
  await withDb((client) => insertHouseholdCategory(client, { id: `e2e-bfe-cat-${tag}`, name: `Food ${tag}` }));
}

// A bill the signed-in member paid in full and split 50/50 with the other
// one: it makes a debt (Clear debt on the budget Overview) and, as a
// monthly template with a hand split, a shared bill due next month on the
// personal budget (Log payment).
async function seedSharedBill(locale: "en" | "sv") {
  const tag = budgetTag();
  const name = `Shared rent ${tag}`;
  const [payer, other, user] =
    locale === "sv" ? [E2E_MEMBER_SV, E2E_MEMBER, E2E_USER_SV] : [E2E_MEMBER, E2E_MEMBER_SV, E2E_USER];
  await withDb(async (client) => {
    await client.query(
      `INSERT INTO "PersonalBudgetCategory" (id, "userId", name, type)
       VALUES ($2, $1, 'Food', 'EXPENSE') ON CONFLICT (id) DO NOTHING`,
      [user.id, `e2e-personal-cat-food-${user.id}`],
    );
    await client.query(`INSERT INTO "BudgetCategory" (id, "householdId", name, type) VALUES ($1, $2, 'Rent', 'EXPENSE')`, [
      `e2e-bfe-rent-${tag}`,
      E2E_HOUSEHOLD.id,
    ]);
    await client.query(
      `INSERT INTO "RecurringTemplate" (id, "householdId", "categoryId", name, amount, type, frequency)
       VALUES ($1, $2, $3, $4, 12000, 'EXPENSE', 'MONTHLY')`,
      [`e2e-bfe-tpl-${tag}`, E2E_HOUSEHOLD.id, `e2e-bfe-rent-${tag}`, name],
    );
    await client.query(
      `INSERT INTO "Transaction" (id, "householdId", "categoryId", amount, type, description, date, "recurringTemplateId")
       VALUES ($1, $2, $3, 12000, 'EXPENSE', $4, date_trunc('month', now()) + interval '14 days', $5)`,
      [`e2e-bfe-tx-${tag}`, E2E_HOUSEHOLD.id, `e2e-bfe-rent-${tag}`, name, `e2e-bfe-tpl-${tag}`],
    );
    await client.query(
      `INSERT INTO "TransactionSplit" (id, "transactionId", "householdMemberId", "amountOwed", "amountPaid")
       VALUES ($1, $3, $4, 6000, 12000), ($2, $3, $5, 6000, 0)`,
      [`e2e-bfe-sa-${tag}`, `e2e-bfe-sb-${tag}`, `e2e-bfe-tx-${tag}`, payer, other],
    );
  });
  return name;
}

/** Counts the Server Action requests the page sends from now on, so a test
 * can show a blocked submit never reached the server. */
function countActionRequests(page: Page) {
  const counter = { count: 0 };
  page.on("request", (request) => {
    if (request.method() === "POST" && "next-action" in request.headers()) counter.count += 1;
  });
  return counter;
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
      // UX-207: Category comes before Amount, so it takes focus first.
      await expect(dialog.getByRole("combobox", { name: t.category })).toBeFocused();
      const amount = dialog.getByLabel(t.recurringAmount);
      await expect(amount).toHaveAttribute("aria-invalid", "true");
      await expect(name).toHaveValue("Rent");
    });

    test("an empty category in Add recurring item is flagged under the field and keeps what was typed", async ({
      page,
    }) => {
      await seedCategory();
      await openAddMenu(page, t, t.recurringMenu);
      const dialog = page.getByRole("dialog", { name: t.recurringTitle });
      const name = dialog.getByLabel(t.recurringName, { exact: true });
      const day = dialog.getByLabel(t.recurringDay);
      await name.fill("Gym");
      await dialog.getByLabel(t.recurringAmount).fill("30");
      await day.fill("12");
      const actions = countActionRequests(page);
      await dialog.getByRole("button", { name: t.recurringSubmit }).click();

      const category = dialog.getByRole("combobox", { name: t.category });
      await expect(dialog.getByRole("alert").filter({ hasText: t.noCategory })).toBeVisible();
      await expect(category).toHaveAttribute("aria-invalid", "true");
      await expect(category).toHaveAccessibleDescription(t.noCategory);
      await expect(category).toBeFocused();
      await expect(name).toHaveValue("Gym");
      await expect(day).toHaveValue("12");
      expect(actions.count).toBe(0);
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

    test("an empty category in Add planned bill is flagged under the field", async ({ page }) => {
      await seedCategory();
      await openAddMenu(page, t, t.billMenu);
      const dialog = page.getByRole("dialog", { name: t.billTitle });
      const name = dialog.getByLabel(t.billName, { exact: true });
      await name.fill("Dentist");
      await dialog.getByLabel(t.billAmount, { exact: true }).fill("80");
      await dialog.getByLabel(t.billDue).fill("2030-05-14");
      const actions = countActionRequests(page);
      await dialog.getByRole("button", { name: t.billSubmit }).click();

      const category = dialog.getByRole("combobox", { name: t.category });
      await expect(dialog.getByRole("alert").filter({ hasText: t.noCategory })).toBeVisible();
      await expect(category).toHaveAttribute("aria-invalid", "true");
      await expect(category).toHaveAccessibleDescription(t.noCategory);
      await expect(category).toBeFocused();
      await expect(name).toHaveValue("Dentist");
      expect(actions.count).toBe(0);
    });

    test("an existing name in Add category keeps the name and limit", async ({ page }) => {
      const tag = budgetTag();
      const existing = `Taken ${tag}`;
      await withDb((client) => insertHouseholdCategory(client, { id: `e2e-bfe-taken-${tag}`, name: existing }));
      await page.goto("/dashboard/budget?tab=manage");
      const opener = page.getByRole("main").getByRole("button", { name: t.addCategory }).first();
      await expectHydrated(opener);
      await expectRouterPatched(page);
      await opener.click();
      const dialog = page.getByRole("dialog", { name: t.addCategory });
      const name = dialog.getByLabel(t.categoryName, { exact: true });
      const limit = dialog.getByLabel(t.categoryLimit);
      await name.fill(existing);
      await limit.fill("250");
      await dialog.getByRole("button", { name: t.addCategory }).click();

      // MAINT-7: the household category actions answer in the user's language.
      await expect(dialog.getByText(t.nameTaken)).toBeVisible();
      await expect(name).toHaveValue(existing);
      await expect(limit).toHaveValue("250");
    });

    test("an empty name in Add category is flagged under the field", async ({ page }) => {
      await page.goto("/dashboard/budget?tab=manage");
      const opener = page.getByRole("main").getByRole("button", { name: t.addCategory }).first();
      await expectHydrated(opener);
      await expectRouterPatched(page);
      await opener.click();
      const dialog = page.getByRole("dialog", { name: t.addCategory });
      await dialog.getByRole("button", { name: t.addCategory }).click();
      const name = dialog.getByLabel(t.categoryName, { exact: true });
      await expect(dialog.getByRole("alert").filter({ hasText: t.noName })).toBeVisible();
      await expect(name).toHaveAttribute("aria-invalid", "true");
      await expect(name).toBeFocused();
      await name.fill("Pets");
      await expect(dialog.getByRole("alert").filter({ hasText: t.noName })).toHaveCount(0);
    });

    test("a cleared name in Edit category is flagged under the field", async ({ page }) => {
      const tag = budgetTag();
      const category = `Edit me ${tag}`;
      await withDb((client) => insertHouseholdCategory(client, { id: `e2e-bfe-edit-${tag}`, name: category }));
      await page.goto("/dashboard/budget?tab=manage");
      const chip = page.getByRole("main").getByRole("button", { name: new RegExp(category) });
      await expectHydrated(chip);
      await expectRouterPatched(page);
      await chip.click();
      const dialog = page.getByRole("dialog", { name: t.editCategoryTitle });
      const name = dialog.getByLabel(t.categoryName, { exact: true });
      await name.fill("");
      await dialog.getByRole("button", { name: t.save, exact: true }).click();
      await expect(dialog.getByRole("alert").filter({ hasText: t.noName })).toBeVisible();
      await expect(name).toHaveAttribute("aria-invalid", "true");
      await expect(name).toBeFocused();
    });

    test("an empty amount and date in Clear debt are flagged under their fields", async ({ page }) => {
      await seedSharedBill(locale);
      await page.goto("/dashboard/budget");
      const opener = page.getByRole("main").getByRole("button", { name: t.clearDebt }).first();
      await expectHydrated(opener);
      await opener.click();
      const dialog = page.getByRole("dialog", { name: t.clearDebt });
      const amount = dialog.getByLabel(t.clearAmount, { exact: true });
      await amount.fill("");
      await dialog.getByLabel(t.date, { exact: true }).fill("");
      await dialog.getByRole("button", { name: t.clearDebtSubmit }).click();
      await expect(dialog.getByRole("alert").filter({ hasText: t.noAmount })).toBeVisible();
      await expect(dialog.getByRole("alert").filter({ hasText: t.noDate })).toBeVisible();
      await expect(amount).toHaveAttribute("aria-invalid", "true");
      await expect(amount).toBeFocused();
      await amount.fill("10");
      await expect(dialog.getByRole("alert").filter({ hasText: t.noAmount })).toHaveCount(0);
      await expect(dialog.getByRole("alert").filter({ hasText: t.noDate })).toBeVisible();
    });

    test("an empty date in the personal budget's Log payment is flagged under the field", async ({ page }) => {
      const name = await seedSharedBill(locale);
      const next = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1);
      const nextKey = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
      await page.goto(`/dashboard/personal-budget?month=${nextKey}`);
      const row = page
        .getByRole("main")
        .getByText(name, { exact: true })
        .filter({ visible: true })
        .first()
        .locator("xpath=ancestor::div[contains(@class,'rounded-md')][1]");
      const opener = row.getByRole("button", { name: t.logPayment });
      await expectHydrated(opener);
      await opener.click();
      const dialog = page.getByRole("dialog", { name: new RegExp(name) });
      await dialog.getByLabel(t.logDescription, { exact: true }).fill("Kept note");
      // An empty amount can't be submitted at all (the split no longer adds
      // up, so Log expense is disabled), which leaves the date to flag.
      const date = dialog.getByLabel(t.date, { exact: true });
      await date.fill("");
      await dialog.getByRole("button", { name: t.logSubmit }).click();
      await expect(dialog.getByRole("alert").filter({ hasText: t.noDate })).toBeVisible();
      await expect(date).toHaveAttribute("aria-invalid", "true");
      await expect(date).toBeFocused();
      await expect(dialog.getByLabel(t.logDescription, { exact: true })).toHaveValue("Kept note");
    });
  });
}
