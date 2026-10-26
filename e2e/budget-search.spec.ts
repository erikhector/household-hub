import { expect, test, type Page } from "@playwright/test";
import { STORAGE_STATE_SV } from "./seed";
import { budgetTag, insertHouseholdCategory, insertHouseholdTransaction, withDb } from "./budget-seed";
import { dismissCookieNotice, expectNoHorizontalOverflow, expectTouchTargets } from "./ui";

// GAP-63: the Transactions tab has a Search field that narrows the month's
// rows by description, category name or amount, client-side, and keeps the
// term in `?q=` so a reload shows the same list.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

const words = {
  en: { search: "Search transactions", clear: "Clear search", empty: (q: string) => `No transactions match “${q}”.` },
  sv: { search: "Sök transaktioner", clear: "Rensa sökning", empty: (q: string) => `Inga transaktioner matchar ”${q}”.` },
};

/** The transaction rows on screen: phone rows are buttons, desktop rows
 * table rows. */
function txRow(page: Page, isMobile: boolean, text: string) {
  const main = page.getByRole("main");
  return isMobile
    ? main.getByRole("button", { name: new RegExp(`^${text}`) })
    : main.getByRole("row").filter({ hasText: text });
}

async function seed() {
  const tag = budgetTag();
  const categoryId = `e2e-search-c-${tag}`;
  await withDb(async (client) => {
    await insertHouseholdCategory(client, { id: categoryId, name: `Hardware ${tag}` });
    await insertHouseholdTransaction(client, { id: `${categoryId}-1`, categoryId, amount: 340.5, description: `Skruvar ${tag}` });
    await insertHouseholdTransaction(client, { id: `${categoryId}-2`, categoryId, amount: 81, description: `Lampa ${tag}` });
  });
  return { tag, screws: `Skruvar ${tag}`, lamp: `Lampa ${tag}` };
}

for (const locale of ["en", "sv"] as const) {
  test.describe(locale, () => {
    if (locale === "sv") test.use({ storageState: STORAGE_STATE_SV });
    const w = words[locale];

    test("typing narrows the month, survives a reload and clears", async ({ page, isMobile }) => {
      const s = await seed();
      await page.goto("/dashboard/budget?tab=transactions");
      const main = page.getByRole("main");
      const search = main.getByRole("searchbox", { name: w.search });
      await expect(txRow(page, isMobile, s.screws)).toBeVisible();
      await expect(txRow(page, isMobile, s.lamp)).toBeVisible();

      await expect(search).toHaveAttribute("enterkeyhint", "search");
      await expect(search).toHaveAttribute("autocomplete", "off");
      if (isMobile) await expectTouchTargets(page);

      await search.fill(s.screws.toLowerCase());
      await expect(txRow(page, isMobile, s.screws)).toBeVisible();
      await expect(txRow(page, isMobile, s.lamp)).toHaveCount(0);
      await expect(page).toHaveURL(/[?&]q=/);
      await expectNoHorizontalOverflow(page);

      await page.reload();
      await expect(main.getByRole("searchbox", { name: w.search })).toHaveValue(s.screws.toLowerCase());
      await expect(txRow(page, isMobile, s.screws)).toBeVisible();
      await expect(txRow(page, isMobile, s.lamp)).toHaveCount(0);

      await main.getByRole("button", { name: w.clear }).click();
      await expect(txRow(page, isMobile, s.screws)).toBeVisible();
      await expect(txRow(page, isMobile, s.lamp)).toBeVisible();
      await expect(page).not.toHaveURL(/[?&]q=/);
    });

    test("an amount with a decimal comma finds its row, and no match offers a clear", async ({ page, isMobile }) => {
      const s = await seed();
      await page.goto("/dashboard/budget?tab=transactions");
      const main = page.getByRole("main");
      const search = main.getByRole("searchbox", { name: w.search });

      await search.fill("340,50");
      await expect(txRow(page, isMobile, s.screws)).toBeVisible();
      await expect(txRow(page, isMobile, s.lamp)).toHaveCount(0);

      await search.fill(`nothing like this ${s.tag}`);
      await expect(main.getByText(w.empty(`nothing like this ${s.tag}`))).toBeVisible();
      await main.getByRole("button", { name: w.clear }).last().click();
      await expect(search).toHaveValue("");
      await expect(txRow(page, isMobile, s.lamp)).toBeVisible();
    });
  });
}
