import { expect, test } from "@playwright/test";

// UX-20: on a phone the inventory header is one labelled "Add item" plus a
// labelled "More inventory actions" menu, and each row collapses its
// secondary actions into a ⋯ menu. On desktop the individual buttons stay.
test("inventory header and row actions adapt to the viewport", async ({ page }) => {
  const isMobile = test.info().project.name === "mobile";
  await page.goto("/dashboard/inventory");
  const main = page.getByRole("main");

  const addItem = main.getByRole("button", { name: "Add item", exact: true }).filter({ visible: true });
  await expect(addItem).toBeVisible();

  // Fixed seeded item (e2e/seed.ts), scoped to its own row.
  const row = main.getByRole("row", { name: /Tomatoes/ }).or(main.getByRole("listitem").filter({ hasText: "Tomatoes" })).filter({ visible: true }).first();
  await expect(row).toBeVisible();

  const headerMore = main.getByRole("button", { name: "More inventory actions", exact: true });
  const rowMore = row.getByRole("button", { name: "More actions", exact: true });

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
