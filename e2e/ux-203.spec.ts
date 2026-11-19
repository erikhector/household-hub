import { expect, test } from "@playwright/test";
import {
  dismissCookieNotice,
  expectHydrated,
  expectRouterPatched,
  expectTargetsApart,
  expectTouchTargets,
  gotoRevealed,
  openRowSheet,
} from "./ui";
import { E2E_ITEM } from "./seed-data";

// UX-203 (DESIGN.md M3): in a recipe's sheet, an ingredient linked to a
// pantry item was a bare 19 px text link marked as running text, so a
// recipe with several linked ingredients stacked 19 px targets 4 px apart.
// Each linked row is now a 44 px target on touch. Measured on the seeded
// "Pancakes" recipe, whose "Wheat flour" ingredient is linked to the
// seeded item (e2e/seed.ts), which no spec unlinks. It also runs on the
// `tablet` project (playwright.config.ts): touch-sized at the desktop shell.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("a linked ingredient is a 44 px row that opens its item and comes back to Recipes", async ({ page }, testInfo) => {
  await gotoRevealed(page, "/dashboard/meal-planning?tab=recipes");
  const search = page.getByPlaceholder("Search recipes…").filter({ visible: true });
  // The search box filters through React state, and the row's sheet pushes
  // a history entry when it opens (MAINT-68), so wait for both first.
  await expectHydrated(search);
  await expectRouterPatched(page);
  await search.fill("Pancakes");
  const sheet = await openRowSheet(page, "Pancakes");
  const link = sheet.getByRole("link", { name: E2E_ITEM.name, exact: true });
  await expect(link).toBeVisible();

  if (testInfo.project.name !== "desktop") {
    const box = await link.boundingBox();
    expect(box, "the link is laid out").not.toBeNull();
    expect(box!.height, "the link's height (M3)").toBeGreaterThanOrEqual(44 - 0.5);
    // The whole sheet, not just this row: the smoke check only measures
    // closed pages, so the sheet's targets were never measured before.
    await expectTouchTargets(page);
    await expectTargetsApart(sheet.getByRole("list").first());
  }

  await link.click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/inventory/items/${E2E_ITEM.id}\\?from=recipes`));
  await expect(page.getByRole("heading", { name: E2E_ITEM.name, level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Recipes", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/meal-planning\?tab=recipes$/);
  await expect(page.getByPlaceholder("Search recipes…").filter({ visible: true })).toBeVisible();
});
