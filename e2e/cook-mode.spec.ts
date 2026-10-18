import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { DIALOG_BACK_PENDING_ATTR } from "@/components/ui/dialog-history";
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

  // Nothing ticked, so closing asks nothing.
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

// UX-94: closing with progress asks first; a back gesture, Escape and the
// Close button all go through the same check.
test("closing cook mode with a ticked step asks before throwing progress away", async ({ page }) => {
  await page.goto("/dashboard/meal-planning?tab=recipes");
  await page.getByRole("searchbox", { name: /Search recipes/ }).fill("Pancakes");
  await (await openRowSheet(page, "Pancakes")).getByRole("button", { name: "Cook", exact: true }).click();
  const cook = page.getByRole("dialog", { name: "Cooking Pancakes" });
  await cook.getByRole("button", { name: "Whisk the batter" }).click();

  await cook.getByRole("button", { name: "Close" }).click();
  const confirm = page.getByRole("dialog", { name: "Stop cooking?" });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByText("Your ticked steps will be cleared.")).toBeVisible();

  // Keep cooking: the view and its tick are untouched.
  await confirm.getByRole("button", { name: "Keep cooking" }).click();
  await expect(confirm).toBeHidden();
  await expect(cook.getByRole("button", { name: "Whisk the batter" })).toHaveAttribute("aria-pressed", "true");
  // The confirm's own history entry comes off asynchronously; let it land
  // before the next close so it can't be mistaken for a back gesture.
  await expect(page.locator("html")).not.toHaveAttribute(DIALOG_BACK_PENDING_ATTR);

  // Escape is guarded too. The browser's own close watcher (Android back,
  // Escape on a touch device) fires for the same keypress, so the prompt
  // must still be open once that has had its say.
  await page.keyboard.press("Escape");
  const again = page.getByRole("dialog", { name: "Stop cooking?" });
  await expect(again).toBeVisible();
  await again.getByRole("button", { name: "Keep cooking" }).click();
  await expect(again).toBeHidden();
  await expect(page.locator("html")).not.toHaveAttribute(DIALOG_BACK_PENDING_ATTR);

  // So is the back gesture; this time stop.
  await page.goBack();
  await expect(page.getByRole("dialog", { name: "Stop cooking?" })).toBeVisible();
  await page.getByRole("dialog", { name: "Stop cooking?" }).getByRole("button", { name: "Stop cooking" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("closing cook mode with a running timer says the timer will stop", async ({ page }) => {
  await page.goto("/dashboard/meal-planning?tab=recipes");
  await page.getByRole("searchbox", { name: /Search recipes/ }).fill("Porridge");
  await (await openRowSheet(page, "Porridge")).getByRole("button", { name: "Cook", exact: true }).click();
  const cook = page.getByRole("dialog", { name: "Cooking Porridge" });
  await cook.getByRole("button", { name: "Start 12 min timer" }).click();

  await cook.getByRole("button", { name: "Close" }).click();
  const confirm = page.getByRole("dialog", { name: "Stop cooking?" });
  await expect(confirm.getByText(/Your timer will stop/)).toBeVisible();
  await confirm.getByRole("button", { name: "Stop cooking" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Next step ticks the current step and moves the highlight on; ingredients tick during prep", async ({ page }, testInfo) => {
  await page.goto("/dashboard/meal-planning?tab=recipes");
  await page.getByRole("searchbox", { name: /Search recipes/ }).fill("Pancakes");
  await (await openRowSheet(page, "Pancakes")).getByRole("button", { name: "Cook", exact: true }).click();
  const cook = page.getByRole("dialog", { name: "Cooking Pancakes" });

  const flour = cook.getByRole("button", { name: /Wheat flour/ });
  await expect(flour).toHaveAttribute("aria-pressed", "false");
  await flour.click();
  await expect(flour).toHaveAttribute("aria-pressed", "true");
  // Ingredients are prep, not progress: closing needs no confirmation.

  const steps = cook.getByRole("listitem").filter({ has: page.getByRole("button", { name: /the (batter|pancakes)/ }) });
  await expect(steps.nth(0)).toHaveAttribute("aria-current", "step");
  await expect(steps.nth(1)).not.toHaveAttribute("aria-current", "step");

  await cook.getByRole("button", { name: "Next step" }).click();
  await expect(cook.getByRole("button", { name: "Whisk the batter" })).toHaveAttribute("aria-pressed", "true");
  await expect(steps.nth(1)).toHaveAttribute("aria-current", "step");
  await expect(steps.nth(1).getByRole("button")).toBeInViewport();
  // For eyeballing the layout: only written when E2E_SCREENSHOT_DIR is set.
  if (process.env.E2E_SCREENSHOT_DIR) {
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${testInfo.project.name}-en-cook-mode.png` });
  }

  // The last step done: no more "Next step", and the recipe list has no meal
  // to mark, so only Close remains.
  await cook.getByRole("button", { name: "Next step" }).click();
  await expect(cook.getByRole("button", { name: "Next step" })).toHaveCount(0);
  await expect(cook.getByRole("button", { name: "Done — mark as cooked" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("after the last step a planned meal offers Done and opens the mark-as-cooked review", async ({ page }) => {
  const suffix = `${E2E_WORKER}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const name = `Cook-done ${suffix}`;
  const day = new Date(Date.UTC(2031, 2, 3) + Math.floor(Math.random() * 300) * 7 * 86_400_000);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "Recipe" (id, "householdId", name, instructions) VALUES ($1, $2, $3, E'Chop the onion\nFry the onion')`,
      [`e2e-recipe-${suffix}`, E2E_HOUSEHOLD.id, name],
    );
    await client.query(
      `INSERT INTO "MealPlan" (id, "householdId", "weekStartDate") VALUES ($1, $2, $3)
       ON CONFLICT ("householdId", "weekStartDate") DO NOTHING`,
      [`e2e-plan-${suffix}`, E2E_HOUSEHOLD.id, day],
    );
    await client.query(
      `INSERT INTO "MealPlanEntry" (id, "mealPlanId", date, "mealType", "recipeId")
       SELECT $1, plan.id, $2, 'DINNER', $3 FROM "MealPlan" plan
       WHERE plan."householdId" = $4 AND plan."weekStartDate" = $2`,
      [`e2e-entry-${suffix}`, day, `e2e-recipe-${suffix}`, E2E_HOUSEHOLD.id],
    );

    await page.goto(`/dashboard/meal-planning?week=${day.toISOString().slice(0, 10)}`);
    await (await openRowSheet(page, name)).getByRole("button", { name: "Cook", exact: true }).click();
    const cook = page.getByRole("dialog", { name: `Cooking ${name}` });
    await expect(cook.getByRole("button", { name: "Done — mark as cooked" })).toHaveCount(0);

    await cook.getByRole("button", { name: "Next step" }).click();
    await cook.getByRole("button", { name: "Next step" }).click();
    await expect(cook.getByRole("button", { name: "Next step" })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    // Done is deliberate: no "Stop cooking?" even though steps are ticked.
    await cook.getByRole("button", { name: "Done — mark as cooked" }).click();

    await expect(page.getByRole("dialog", { name: "Stop cooking?" })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Mark as cooked" })).toBeVisible();
  } finally {
    await client.query(`DELETE FROM "MealPlanEntry" WHERE id = $1`, [`e2e-entry-${suffix}`]);
    await client.query(`DELETE FROM "Recipe" WHERE id = $1 AND "householdId" = $2`, [
      `e2e-recipe-${suffix}`,
      E2E_HOUSEHOLD.id,
    ]);
    await client.end();
  }
});
