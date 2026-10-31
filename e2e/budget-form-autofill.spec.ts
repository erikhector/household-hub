import { expect, test, type Locator } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { addBillOrIncome, dismissCookieNotice } from "./ui";

// UX-147 (DESIGN.md "right keyboard and autofill"): a budget text field must
// not offer the browser's saved names and contacts (`autocomplete="off"`),
// and the last field of each form gives the phone's action key a label.

async function expectNoAutofill(dialog: Locator) {
  // Base UI's Select and Combobox keep an aria-hidden input for form
  // submission; the user never types in it, so it is not a field here.
  const fields = dialog.locator(
    'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([aria-hidden="true"])',
  );
  // The budget dialogs are lazy-loaded (PERF-30): the dialog can be open
  // before its chunk has rendered the form, so wait for the first field
  // instead of counting once (MAINT-71 saw 0 fields on a loaded runner).
  await expect.poll(() => fields.count()).toBeGreaterThan(0);
  const count = await fields.count();
  for (let i = 0; i < count; i++) {
    await expect(fields.nth(i)).toHaveAttribute("autocomplete", "off");
  }
}

test("budget dialogs turn autofill off and set the Enter key on the last field", async ({
  page,
  context,
  baseURL,
}) => {
  await dismissCookieNotice(context, baseURL!);
  // Bills & income's Add and "Add transaction" stay disabled until the
  // household has a category, and the seed has none.
  const categoryId = `e2e-autofill-cat-${Date.now().toString(36)}-w${E2E_WORKER}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "BudgetCategory" (id, "householdId", name, type) VALUES ($1, $2, 'Autofill cat', 'EXPENSE')`,
      [categoryId, E2E_HOUSEHOLD.id],
    );
    await page.goto("/dashboard/budget?tab=manage");
    const main = page.getByRole("main");

    await main.getByRole("button", { name: "Add category", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await expectNoAutofill(dialog);
    // An expense category ends on the monthly limit.
    await expect(dialog.getByLabel("Monthly limit")).toHaveAttribute("enterkeyhint", "done");
    await page.keyboard.press("Escape");

    await addBillOrIncome(page, "Repeats every month or year");
    dialog = page.getByRole("dialog");
    await expectNoAutofill(dialog);
    await expect(dialog.getByLabel("Due day")).toHaveAttribute("enterkeyhint", "done");
    // Splitting the bill adds one amount field per member after Due day, so
    // the Enter key moves on from Due day and only the last share ends the form.
    await dialog.getByLabel("Split this bill").check();
    await expectNoAutofill(dialog);
    await expect(dialog.getByLabel("Due day")).toHaveAttribute("enterkeyhint", "next");
    const shares = dialog.locator('input[name="splitAmount"]');
    expect(await shares.count()).toBeGreaterThan(1);
    await expect(shares.first()).toHaveAttribute("enterkeyhint", "next");
    await expect(shares.last()).toHaveAttribute("enterkeyhint", "done");
    await page.keyboard.press("Escape");

    await page.goto("/dashboard/budget");
    await page.getByRole("button", { name: "Add transaction" }).first().click();
    dialog = page.getByRole("dialog");
    await expectNoAutofill(dialog);
    await expect(dialog.getByLabel("Description")).toHaveAttribute("enterkeyhint", "done");
  } finally {
    await client.query(`DELETE FROM "BudgetCategory" WHERE id = $1`, [categoryId]);
    await client.end();
  }
});
