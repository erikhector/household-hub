import { expect, test } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { dismissCookieNotice, expectNoHorizontalOverflow, openRowSheet } from "./ui";

// UX-92: a recipe's sheet lists its instruction steps under the ingredients
// and has "Add to plan", which opens the date and slot picker. The seeded
// "Porridge" recipe has two steps and "Cinnamon buns" none (e2e/seed.ts).
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

const DAY_MS = 24 * 60 * 60 * 1000;

test("the sheet lists the instruction steps, and none for a recipe without any", async ({ page }) => {
  const t = en.mealPlanning;
  await page.goto("/dashboard/meal-planning?tab=recipes");

  const sheet = await openRowSheet(page, "Porridge");
  await expect(sheet.getByRole("heading", { name: t.instructionsLabel })).toBeVisible();
  const steps = sheet.getByRole("list").last().getByRole("listitem");
  await expect(steps).toHaveText(["Stir in the oats", "Simmer for 10-12 minutes"]);
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  const buns = await openRowSheet(page, "Cinnamon buns");
  await expect(buns.getByRole("heading", { name: t.instructionsLabel })).toHaveCount(0);
});

test("Add to plan in the sheet plans the recipe on the picked day", async ({ page }) => {
  const t = en.mealPlanning;
  // A day years ahead, where no other spec plans anything.
  const day = new Date(Date.now() + (800 + Math.floor(Math.random() * 3000)) * DAY_MS);
  const dateKey = day.toISOString().slice(0, 10);
  const monday = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) - ((day.getUTCDay() + 6) % 7) * DAY_MS)
    .toISOString()
    .slice(0, 10);

  await page.goto("/dashboard/meal-planning?tab=recipes");
  const sheet = await openRowSheet(page, "Porridge");
  await sheet.getByRole("button", { name: t.addToPlanButton, exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Add Porridge to the plan" });
  await expect(dialog).toBeVisible();
  await expect(sheet).toBeHidden();
  await dialog.getByLabel(t.dateLabel).fill(dateKey);
  await dialog.getByRole("button", { name: t.addToPlanSubmit, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Added Porridge to the plan")).toBeVisible();

  // Saved: still there on that day's week after a reload.
  await page.goto(`/dashboard/meal-planning?week=${monday}`);
  await expect(page.getByText("Porridge", { exact: true }).filter({ visible: true })).toHaveCount(1);
});
