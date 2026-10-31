import { expect, test } from "@playwright/test";
import { budgetTag, insertHouseholdCategory, withDb } from "./budget-seed";
import { E2E_HOUSEHOLD } from "./seed";
import { addBillOrIncome, dismissCookieNotice, expectNoHorizontalOverflow, expectTouchTargets } from "./ui";

// Budget redesign (Oct 2026): the Setup tab's Bills & income card is the one
// place a budget's expected amounts are added. One Add button asks which
// kind (repeats, one-off bill, one-off income) and opens the existing
// dialog; a new recurring item lands under "Repeating" with a status chip,
// and, being due, at the top of the Overview's Needs attention card with a
// count. The category is seeded straight into Postgres; the item itself is
// made through the UI, since that's what's under test.
let itemName: string | undefined;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

// Only this worker's household, and only the item this test made.
test.afterEach(async () => {
  if (!itemName) return;
  const name = itemName;
  itemName = undefined;
  await withDb((client) =>
    client.query(`DELETE FROM "RecurringTemplate" WHERE "householdId" = $1 AND name = $2`, [E2E_HOUSEHOLD.id, name]),
  );
});

test("adds a repeating bill from the one Add menu and shows it as due on the Overview", async ({
  page,
  isMobile,
}) => {
  const tag = budgetTag();
  const category = `Streaming ${tag}`;
  await withDb((client) => insertHouseholdCategory(client, { id: `e2e-bai-cat-${tag}`, name: category }));
  const name = `Music ${tag}`;
  itemName = name;
  const main = page.getByRole("main");

  await page.goto("/dashboard/budget?tab=manage");
  const card = main.getByRole("region", { name: "Bills & income" });
  await expect(card).toBeVisible();
  // The old per-kind panels and their Add buttons are gone.
  for (const old of ["Add recurring item", "Add planned bill", "Add planned income"]) {
    await expect(main.getByRole("button", { name: old })).toHaveCount(0);
  }

  await addBillOrIncome(page, "Repeats every month or year");
  await expect(page.getByRole("menuitem", { name: "One-off bill" })).toHaveCount(0);
  const dialog = page.getByRole("dialog", { name: "Add recurring item" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Expected amount").fill("119");
  await dialog.getByRole("combobox", { name: "Category" }).fill(category);
  await page.getByRole("option", { name: category, exact: true }).click();
  await dialog.getByRole("button", { name: "Add item" }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  const repeating = main.getByRole("region", { name: "Repeating" });
  const row = repeating.getByRole("listitem").filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row.getByText("Due", { exact: true })).toBeVisible();
  if (isMobile) await expectTouchTargets(page);
  await expectNoHorizontalOverflow(page);

  // Due, so it's on the Overview's Needs attention card, with its Log.
  await page.getByRole("tab", { name: "Overview" }).click();
  const needs = main.locator('[data-slot="card"]').filter({ has: page.getByRole("heading", { name: /^Needs attention/ }) });
  await expect(needs.getByText(name, { exact: true })).toBeVisible();
  await expect(needs.getByRole("heading", { name: /^Needs attention\s*\d+$/ })).toBeVisible();
  await expect(needs.getByRole("button", { name: `More actions for ${name}` })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

// The Add menu's dialogs open through dialog handles; closing one puts focus
// back on the Add button (they used to open from hidden aria-hidden buttons,
// which is where focus was left).
test("closing a dialog opened from the Add menu puts focus back on Add", async ({ page }) => {
  const tag = budgetTag();
  await withDb((client) => insertHouseholdCategory(client, { id: `e2e-bai-cat-${tag}`, name: `Focus ${tag}` }));
  await page.goto("/dashboard/budget?tab=manage");
  const add = page
    .getByRole("main")
    .getByRole("region", { name: "Bills & income" })
    .getByRole("button", { name: "Add", exact: true });

  for (const [item, title] of [
    ["Repeats every month or year", "Add recurring item"],
    ["One-off bill", "Add planned bill"],
  ] as const) {
    await addBillOrIncome(page, item);
    await expect(page.getByRole("dialog", { name: title })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(add).toBeFocused();
  }
});
