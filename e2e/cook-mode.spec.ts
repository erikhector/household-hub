import { expect, test } from "@playwright/test";
import { dismissCookieNotice, expectNoHorizontalOverflow, openRowSheet } from "./ui";

// GAP-42: the full-screen "Cook" view on a recipe with instructions. The
// seeded "Pancakes" recipe has two steps (e2e/seed.ts); a recipe without
// instructions ("Cinnamon buns") gets no Cook button in its sheet. Nothing is saved, so
// the ticks are asserted in place and need no cleanup.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("cook mode opens, ticks a step off and closes back to the recipe list", async ({ page }) => {
  await page.goto("/dashboard/meal-planning?tab=recipes");

  // A recipe without steps has nothing to cook from.
  await page.getByRole("searchbox", { name: /Search recipes/ }).fill("Cinnamon buns");
  const buns = await openRowSheet(page, "Cinnamon buns");
  await expect(buns.getByRole("button", { name: "Edit recipe" })).toBeVisible();
  await expect(buns.getByRole("button", { name: "Cook", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(buns).toBeHidden();

  await page.getByRole("searchbox", { name: /Search recipes/ }).fill("Pancakes");
  await (await openRowSheet(page, "Pancakes")).getByRole("button", { name: "Cook", exact: true }).click();

  const cook = page.getByRole("dialog", { name: "Cooking Pancakes" });
  await expect(cook).toBeVisible();
  // The recipe's own amounts: no meal entry, so nothing to scale.
  await expect(cook.getByText("Wheat flour")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const step = cook.getByRole("button", { name: "Whisk the batter" });
  await expect(step).toHaveAttribute("aria-pressed", "false");
  await step.click();
  await expect(step).toHaveAttribute("aria-pressed", "true");
  // The other step is untouched, and a second tap un-ticks.
  await expect(cook.getByRole("button", { name: "Fry the pancakes" })).toHaveAttribute("aria-pressed", "false");
  await step.click();
  await expect(step).toHaveAttribute("aria-pressed", "false");
  await step.click();

  await cook.getByRole("button", { name: "Close" }).click();
  await expect(cook).toBeHidden();
  // Back on the recipe list, not on the recipe's sheet.
  await expect(page.getByRole("button", { name: "New recipe" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Ticks aren't remembered: reopening starts fresh.
  await (await openRowSheet(page, "Pancakes")).getByRole("button", { name: "Cook", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Cooking Pancakes" }).getByRole("button", { name: "Whisk the batter" }),
  ).toHaveAttribute("aria-pressed", "false");
});

// GAP-50: a step that names a duration gets a timer button (the seeded
// "Porridge" has "Simmer for 10-12 minutes", so the upper bound, 12 min); a
// step without one doesn't. Timers are component state, so nothing to clean up.
test("a step with a duration starts a countdown timer and stops it", async ({ page }) => {
  await page.goto("/dashboard/meal-planning?tab=recipes");
  await page.getByRole("searchbox", { name: /Search recipes/ }).fill("Porridge");
  await (await openRowSheet(page, "Porridge")).getByRole("button", { name: "Cook", exact: true }).click();

  const cook = page.getByRole("dialog", { name: "Cooking Porridge" });
  await expect(cook).toBeVisible();
  // Only the step with a duration offers a timer.
  await expect(cook.getByRole("button", { name: /timer$/ })).toHaveCount(1);
  await expect(cook.getByRole("timer")).toHaveCount(0);

  await cook.getByRole("button", { name: "Start 12 min timer" }).click();
  const chip = cook.getByRole("timer");
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText(/^1[12]:\d\d$/);
  await expect(cook.getByRole("button", { name: "Start 12 min timer" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  // Ticking the step off doesn't touch the timer, and Stop clears it.
  await cook.getByRole("button", { name: "Simmer for 10-12 minutes" }).click();
  await expect(chip).toBeVisible();
  await cook.getByRole("button", { name: "Stop timer" }).click();
  await expect(chip).toHaveCount(0);
  await expect(cook.getByRole("button", { name: "Start 12 min timer" })).toBeVisible();
});
