import { expect, test, type Locator, type Page } from "@playwright/test";
import { STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow, expectRouterPatched, gotoRevealed, LOCALES } from "./ui";

// UX-199 (DESIGN.md principle 3, hierarchy; M9): the inventory's "Last
// updated" and "Group by" filters show "label: value", and their fixed
// widths (`w-48`, `w-44`) cut off the value, the one part the control is
// for: "Senast uppdaterad: N…", "Group by: No group…". On touch there's no
// hover title to read the rest. Now they size to their content, so every
// option, the longest included, reads in full. It also runs on the `tablet`
// and `landscape` projects (playwright.config.ts), the touch widths with the
// unfolded filter row. Phones fold the filters into the Filters dialog, where
// each trigger is full width; the same check runs there.
const TEXT = {
  en: {
    updated: "Last updated",
    updatedOptions: ["Any time", "Today", "This week", "Not updated in 30+ days", "Not updated in 90+ days"],
    groupBy: "Group by",
    groupByOptions: ["No grouping", "Category", "Location", "Category & location"],
    filters: "Filters",
  },
  sv: {
    updated: "Senast uppdaterad",
    updatedOptions: ["När som helst", "Idag", "Denna vecka", "Ej uppdaterad på 30+ dagar", "Ej uppdaterad på 90+ dagar"],
    groupBy: "Gruppera efter",
    groupByOptions: ["Ingen gruppering", "Kategori", "Plats", "Kategori & plats"],
    filters: "Filter",
  },
} as const;

async function expectWholeValue(trigger: Locator, option: string) {
  await expect(trigger).toContainText(option);
  const value = trigger.locator('[data-slot="select-value"]');
  const { scrollWidth, clientWidth } = await value.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(scrollWidth, `"${option}" fits its trigger without an ellipsis`).toBeLessThanOrEqual(clientWidth);
}

async function pick(page: Page, trigger: Locator, option: string) {
  await trigger.click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(page.getByRole("listbox")).toBeHidden();
}

for (const locale of LOCALES) {
  test.describe(`inventory filter widths (${locale})`, () => {
    // Signed in, the language comes from the account (see smoke.spec.ts).
    test.use({ storageState: locale === "sv" ? STORAGE_STATE_SV : STORAGE_STATE });
    test.beforeEach(async ({ context, baseURL }) => {
      await dismissCookieNotice(context, baseURL!);
    });

    test("Last updated and Group by show their whole value, whichever is chosen", async ({ page }) => {
      const t = TEXT[locale];
      await gotoRevealed(page, "/dashboard/inventory");
      const main = page.getByRole("main");

      // Below `sm` the selects live in the Filters dialog.
      const folded = (page.viewportSize()?.width ?? 0) < 640;
      let scope: Locator = main;
      if (folded) {
        const filters = main.getByRole("button", { name: t.filters, exact: true });
        await expectHydrated(filters);
        // The dialog pushes a history entry as it opens (MAINT-68).
        await expectRouterPatched(page);
        await filters.click();
        scope = page.getByRole("dialog");
      }
      const updated = scope.getByRole("combobox", { name: t.updated, exact: true });
      const groupBy = scope.getByRole("combobox", { name: t.groupBy, exact: true });
      await expectHydrated(updated);

      // The defaults first.
      await expectWholeValue(updated, t.updatedOptions[0]);
      await expectWholeValue(groupBy, t.groupByOptions[0]);
      await expectNoHorizontalOverflow(page);

      try {
        // Every option, so the longest ("Ej uppdaterad på 90+ dagar",
        // "Category & location") is covered whatever the font measures.
        for (const option of t.updatedOptions.slice(1)) {
          await pick(page, updated, option);
          await expectWholeValue(updated, option);
        }
        for (const option of t.groupByOptions.slice(1)) {
          await pick(page, groupBy, option);
          await expectWholeValue(groupBy, option);
        }
        // Both at their longest at once: the row wraps rather than
        // pushing the page sideways.
        await expectNoHorizontalOverflow(page);
      } finally {
        // The filters are remembered for the signed-in user, whom the
        // other inventory specs share, so put both back to the defaults.
        await pick(page, updated, t.updatedOptions[0]);
        await pick(page, groupBy, t.groupByOptions[0]);
      }
    });
  });
}
