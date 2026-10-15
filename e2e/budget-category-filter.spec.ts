import { expect, test, type Page } from "@playwright/test";
import {
  budgetTag,
  insertHouseholdCategory,
  insertHouseholdTransaction,
  insertPersonalCategory,
  insertPersonalTransaction,
  withDb,
} from "./budget-seed";
import { dismissCookieNotice, expectNoHorizontalOverflow, expectTouchTargets } from "./ui";

// Phone pass (Oct 2026), P3: the Transactions tab filters by category
// (`?category=`, picked from a select), and each category row on Insights
// opens Transactions filtered to it for the same month. A filter that
// isn't one of the viewer's own categories is ignored.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

type Seeded = { tag: string; a: string; b: string; empty: string; aId: string; emptyId: string };

async function seedHousehold(): Promise<Seeded> {
  const tag = budgetTag();
  const ids = { a: `e2e-filter-a-${tag}`, b: `e2e-filter-b-${tag}`, empty: `e2e-filter-e-${tag}` };
  const seeded = { tag, a: `Groceries ${tag}`, b: `Transport ${tag}`, empty: `Gifts ${tag}`, aId: ids.a, emptyId: ids.empty };
  await withDb(async (client) => {
    await insertHouseholdCategory(client, { id: ids.a, name: seeded.a });
    await insertHouseholdCategory(client, { id: ids.b, name: seeded.b });
    await insertHouseholdCategory(client, { id: ids.empty, name: seeded.empty });
    await insertHouseholdTransaction(client, { id: `${ids.a}-tx`, categoryId: ids.a, amount: 81, description: `Milk ${tag}` });
    await insertHouseholdTransaction(client, { id: `${ids.b}-tx`, categoryId: ids.b, amount: 26, description: `Ticket ${tag}` });
  });
  return seeded;
}

/** The transaction rows on screen: phone rows are buttons, desktop rows
 * table rows. */
function txRow(page: Page, isMobile: boolean, text: string) {
  const main = page.getByRole("main");
  return isMobile
    ? main.getByRole("button", { name: new RegExp(`^${text}`) })
    : main.getByRole("row").filter({ hasText: text });
}

test("a category on Insights opens Transactions filtered to it", async ({ page, isMobile }) => {
  const s = await seedHousehold();
  await page.goto("/dashboard/budget?tab=insights");
  const main = page.getByRole("main");

  await main.getByRole("link", { name: new RegExp(s.a) }).click();
  await expect(page).toHaveURL(new RegExp(`[?&]tab=transactions.*[?&]category=${s.aId}`));
  await expect(main.getByRole("tab", { name: "Transactions" })).toHaveAttribute("aria-selected", "true");
  await expect(txRow(page, isMobile, `Milk ${s.tag}`)).toBeVisible();
  await expect(txRow(page, isMobile, `Ticket ${s.tag}`)).toHaveCount(0);
  await expect(main.getByRole("combobox", { name: "Category" })).toContainText(s.a);
  if (isMobile) await expectTouchTargets(page);
  await expectNoHorizontalOverflow(page);

  // Paging months keeps the filter (and the tab).
  const prev = main.getByRole("link", { name: "Previous month" });
  await expect(prev).toHaveAttribute("href", new RegExp(`tab=transactions&category=${s.aId}`));

  await main.getByRole("button", { name: "Clear filter" }).click();
  await expect(txRow(page, isMobile, `Ticket ${s.tag}`)).toBeVisible();
  await expect(page).not.toHaveURL(/[?&]category=/);
  await expect(main.getByRole("tab", { name: "Transactions" })).toHaveAttribute("aria-selected", "true");
});

test("the category select narrows the list, and shows an empty state", async ({ page, isMobile }) => {
  const s = await seedHousehold();
  await page.goto("/dashboard/budget?tab=transactions");
  const main = page.getByRole("main");
  const select = main.getByRole("combobox", { name: "Category" });

  await select.click();
  await page.getByRole("option", { name: s.b, exact: true }).click();
  await expect(txRow(page, isMobile, `Ticket ${s.tag}`)).toBeVisible();
  await expect(txRow(page, isMobile, `Milk ${s.tag}`)).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`[?&]category=`));

  // A category with nothing logged this month says so, and offers a way out.
  await select.click();
  await page.getByRole("option", { name: s.empty, exact: true }).click();
  await expect(main.getByText(`Nothing logged in ${s.empty} this month.`)).toBeVisible();
  await main.getByRole("button", { name: "Clear filter" }).click();
  await expect(txRow(page, isMobile, `Milk ${s.tag}`)).toBeVisible();
});

test("a category id that isn't the household's own is ignored", async ({ page, isMobile }) => {
  const s = await seedHousehold();
  await page.goto("/dashboard/budget?tab=transactions&category=not-a-category-of-ours");
  await expect(txRow(page, isMobile, `Milk ${s.tag}`)).toBeVisible();
  await expect(txRow(page, isMobile, `Ticket ${s.tag}`)).toBeVisible();
  await expect(page.getByRole("main").getByRole("button", { name: "Clear filter" })).toHaveCount(0);
});

test("personal budget: a category on Insights drills into Transactions", async ({ page, isMobile }) => {
  const tag = budgetTag();
  const category = `Hobbies ${tag}`;
  const other = `Books ${tag}`;
  await withDb(async (client) => {
    await insertPersonalCategory(client, { id: `e2e-pfilter-a-${tag}`, name: category });
    await insertPersonalCategory(client, { id: `e2e-pfilter-b-${tag}`, name: other });
    await insertPersonalTransaction(client, {
      id: `e2e-pfilter-a-tx-${tag}`,
      categoryId: `e2e-pfilter-a-${tag}`,
      amount: 140,
      description: `Yarn ${tag}`,
    });
    await insertPersonalTransaction(client, {
      id: `e2e-pfilter-b-tx-${tag}`,
      categoryId: `e2e-pfilter-b-${tag}`,
      amount: 99,
      description: `Novel ${tag}`,
    });
  });
  await page.goto("/dashboard/personal-budget?tab=insights");
  const main = page.getByRole("main");
  await main.getByRole("link", { name: new RegExp(category) }).click();
  await expect(main.getByRole("tab", { name: "Transactions" })).toHaveAttribute("aria-selected", "true");
  await expect(txRow(page, isMobile, `Yarn ${tag}`)).toBeVisible();
  await expect(txRow(page, isMobile, `Novel ${tag}`)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
