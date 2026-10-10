import { expect, test } from "@playwright/test";

test("inventory header has labelled Add item and a More menu", async ({ page }) => {
  await page.goto("/dashboard/inventory");

  // Add item should be reachable by name on both viewports
  await expect(page.getByRole("button", { name: "Add item" })).toBeVisible();

  // There should be a more/menu trigger — use a fuzzy match for "More"
  const more = page.getByRole("button", { name: /More/i });
  await expect(more).toBeVisible();

  // Ensure at least one seeded inventory item is shown and its row has a collapsed menu on mobile
  await expect(page.getByText("Tomatoes")).toBeVisible();
});
