import { expect, test } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { expectHydrated } from "./ui";
import { E2E_SHOPPING_LIST } from "./seed-data";

// UX-41d: an icon-only button shows its aria-label as a Tooltip on hover and
// keyboard focus. Desktop only: touch never opens it (the label stays the
// accessible name there).
test("an icon-only button shows its label as a tooltip on hover and focus", async ({ page }) => {
  await page.goto(`/dashboard/shopping-list/${E2E_SHOPPING_LIST.id}`);
  const more = page.getByRole("button", { name: en.shoppingList.moreActions });
  await expectHydrated(more);

  await more.hover();
  const tip = page.locator("[data-side]").filter({ hasText: en.shoppingList.moreActions });
  await expect(tip.last()).toBeVisible();

  await page.mouse.move(0, 0);
  await expect(tip).toHaveCount(0);

  await more.focus();
  await expect(tip.last()).toBeVisible();
});
