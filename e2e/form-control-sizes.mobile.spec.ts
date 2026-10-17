import { expect, test, type Locator } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER, E2E_SHOPPING_LIST } from "./seed-data";
import { clickRowAction, dismissCookieNotice } from "./ui";

// UX-10 (DESIGN.md M4): a focused field under 16 px makes iOS zoom the page,
// and a unit field too narrow for its own buttons shows "p" for "pcs". Every
// visible, focusable field in each dialog below must compute to >= 16 px.
// Base UI renders aria-hidden mirror inputs (form value carriers) that are
// never focused, so those are skipped.
// UX-8: runs on every touch project (phone, landscape, tablet), since the
// 16 px rule follows the pointer, not the width.
test.skip(({ isMobile }) => !isMobile, "touch font-size rule: a mouse on desktop is deliberately text-sm");

async function expectFieldsAtLeast16px(dialog: Locator) {
  const fields = await dialog.locator("input, textarea, [role=combobox]").evaluateAll((els) =>
    els
      .filter((el) => {
        const input = el as HTMLInputElement;
        const rect = el.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          !el.closest("[aria-hidden=true]") &&
          !["hidden", "checkbox", "radio", "file", "submit", "button"].includes(input.type) &&
          getComputedStyle(el).visibility !== "hidden"
        );
      })
      .map((el) => ({
        label: el.getAttribute("aria-label") ?? el.id ?? el.tagName,
        size: parseFloat(getComputedStyle(el).fontSize),
      })),
  );
  expect(fields.length, "dialog has at least one field").toBeGreaterThan(0);
  for (const field of fields) expect(field.size, `font-size of ${field.label}`).toBeGreaterThanOrEqual(16);
}

const fitsItsValue = (field: Locator) =>
  field.evaluate((el: HTMLInputElement) => el.scrollWidth <= el.clientWidth);

test("shopping add and edit item dialogs use 16px fields and show the whole unit", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await page.goto(`/dashboard/shopping-list/${E2E_SHOPPING_LIST.id}`);

  await page.getByRole("button", { name: "More list actions" }).click();
  await page.getByRole("menuitem", { name: "Add item" }).click();
  const add = page.getByRole("dialog", { name: "Add an item" });
  await expectFieldsAtLeast16px(add);
  const addUnit = add.locator("#add-item-unit");
  await addUnit.fill("pcs");
  expect(await fitsItsValue(addUnit)).toBe(true);
  // Escape would only close the unit combobox's open suggestions first.
  await page.goto(`/dashboard/shopping-list/${E2E_SHOPPING_LIST.id}`);

  // On a phone the row's Edit sits behind its ⋯ (RowActionsMenu); the
  // landscape and tablet projects are touch too but `sm` and up, where the
  // row shows its Edit icon and the ⋯ is hidden.
  await clickRowAction(page, { button: "Edit Apples", menu: "More actions for Apples", item: "Edit" });
  const edit = page.getByRole("dialog");
  await expectFieldsAtLeast16px(edit);
  const unit = edit.locator("#edit-item-unit");
  await expect(unit).toHaveValue("pcs");
  expect(await fitsItsValue(unit)).toBe(true);
});

test("budget transaction and recurring dialogs use 16px fields", async ({ page, context, baseURL }) => {
  // On a phone the cookie notice covers the floating primary action (UX-40).
  await dismissCookieNotice(context, baseURL!);
  // The dialogs' triggers stay disabled until the household has a category.
  const categoryId = `e2e-fcs-cat-${Date.now().toString(36)}-w${E2E_WORKER}`;
  // Removed in `finally` so specs sharing the seeded household stay isolated.
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "BudgetCategory" (id, "householdId", name, type) VALUES ($1, $2, 'Groceries FCS', 'EXPENSE')`,
      [categoryId, E2E_HOUSEHOLD.id],
    );
    await page.goto("/dashboard/budget");
    await page.getByRole("button", { name: "Add transaction" }).first().click();
    await expectFieldsAtLeast16px(page.getByRole("dialog"));
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Manage recurring items" }).click();
    await page.getByRole("button", { name: "Add recurring item" }).click();
    await expectFieldsAtLeast16px(page.getByRole("dialog"));
  } finally {
    await client.query(`DELETE FROM "BudgetCategory" WHERE id = $1`, [categoryId]);
    await client.end();
  }
});
