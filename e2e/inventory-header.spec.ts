import { expect, test } from "@playwright/test";
import { gotoRevealed } from "./ui";

// UX-20: on a phone the inventory header is one labelled "Add item" plus an
// icon-only "More inventory actions" menu (UX-166), and each row collapses its
// secondary actions into a ⋯ menu. On desktop the individual buttons stay.
test("inventory header and row actions adapt to the viewport", async ({ page }) => {
  const isMobile = test.info().project.name === "mobile";
  await page.goto("/dashboard/inventory");
  const main = page.getByRole("main");

  const addItem = main.getByRole("button", { name: "Add item", exact: true }).filter({ visible: true });
  await expect(addItem).toBeVisible();

  // Fixed seeded item (e2e/seed.ts): search narrows the list to its one row.
  await page.getByPlaceholder("Search by name…").filter({ visible: true }).fill("Tomatoes");
  await expect(main.getByText("Tomatoes", { exact: true }).filter({ visible: true })).toBeVisible();

  const headerMore = main.getByRole("button", { name: "More inventory actions", exact: true });
  const rowMore = main.getByRole("button", { name: "More actions", exact: true }).filter({ visible: true });

  if (isMobile) {
    await expect(headerMore).toBeVisible();
    await expect(rowMore).toBeVisible();
    await rowMore.click();
    await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
  } else {
    await expect(headerMore).toBeHidden();
    await expect(rowMore).toBeHidden();
  }
});

// UX-166: the phone header is one row of search, Filters and ⋯, so the first
// inventory row starts within the top 300 px instead of ~400 px down.
test.describe("phone header row", () => {
  test.skip(() => test.info().project.name !== "mobile", "phone layout");

  test("the first inventory row starts near the top and ⋯ is grouped", async ({ page }) => {
    await gotoRevealed(page, "/dashboard/inventory");
    const main = page.getByRole("main");
    const search = main.getByRole("searchbox").filter({ visible: true });
    const filters = main.getByRole("button", { name: /^Filters/ });
    const more = main.getByRole("button", { name: "More inventory actions", exact: true });
    await expect(search).toBeVisible();
    await expect(filters).toBeVisible();
    await expect(more).toBeVisible();

    const firstRow = main.getByRole("listitem").filter({ visible: true }).first();
    await expect(firstRow).toBeVisible();
    const box = await firstRow.boundingBox();
    expect(box!.y).toBeLessThan(300);

    // Search and Filters share one row.
    const [s, f] = [await search.boundingBox(), await filters.boundingBox()];
    expect(Math.abs(s!.y + s!.height / 2 - (f!.y + f!.height / 2))).toBeLessThan(8);

    await more.click();
    const menu = page.getByRole("menu");
    await expect(menu.getByText("Add by scanning", { exact: true })).toBeVisible();
    await expect(menu.getByText("Manage", { exact: true })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Scan multiple" })).toBeVisible();
  });
});
