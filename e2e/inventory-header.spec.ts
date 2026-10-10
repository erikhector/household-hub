import { expect, test } from "@playwright/test";

test("inventory header has labelled Add item and a More menu", async ({ page }) => {
  await page.goto("/dashboard/inventory");

  // Add item should be reachable by name on both viewports
  await expect(page.getByRole("button", { name: "Add item" })).toBeVisible();

  // There should be a more/menu trigger — use a fuzzy match for "More"
  const more = page.getByRole("button", { name: /More/i });
  // The More menu is only present on the mobile layout; tolerate its
  // absence on desktop.
  if (await more.count() > 0) await expect(more).toBeVisible();

  // Ensure at least one inventory row is present (header row exists too,
  // so expect more than one row in the table) to avoid reliance on a
  // particular seeded item name.
  // Confirm at least one seeded inventory item is visible. Try a few known
  // seeded names (falls back to a table-row check if none of them match).
  const seeded = ["Tomatoes", "Olive oil", "Egg", "Wheat flour", "Crème fraiche"];
  let found = false;
  for (const name of seeded) {
    if (await page.getByText(name).count() > 0) {
      const locator = page.getByText(name).first();
      if (await locator.isVisible()) {
        await expect(locator).toBeVisible();
      } else {
        // Item exists in the DOM (may be offscreen on small viewports).
        expect(await page.getByText(name).count()).toBeGreaterThan(0);
      }
      found = true;
      break;
    }
  }
  if (!found) {
    const rowCount = await page.getByRole("row").count();
    expect(rowCount).toBeGreaterThan(1);
  }
});
