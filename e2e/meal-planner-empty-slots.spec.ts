import { expect, test } from "@playwright/test";
import { withCurrentWeekMeal } from "./current-week-meal";
import { dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow } from "./ui";

// UX-5 / UX-21 / UX-50: a day with nothing planned is one "+ Add meal" button
// that asks for the slot, not four "<slot> + Add meal" rows, and a week with
// nothing planned at all is a single empty state with "Add your first dinner"
// instead of seven of those buttons, so an empty week isn't a wall of
// identical text on a phone. The household is shared by the desktop
// and mobile runs, so each test uses a far-future week nobody else plans in;
// the add test picks its own per project, since a meal added by the first run
// would make its day non-empty for the second.
const EMPTY_WEEK = "2031-01-06";
const addWeek = (project: string) => (project === "mobile" ? "2031-01-20" : "2031-01-13");

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("an empty week is one empty state with one primary, not seven add cards", async ({ page }, testInfo) => {
  await page.goto(`/dashboard/meal-planning?week=${EMPTY_WEEK}`);

  // UX-50: no per-day cards and no repeated placeholder at all.
  await expect(page.getByRole("button", { name: /^Add meal, / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(Breakfast|Lunch|Dinner|Snack) Add meal$/ })).toHaveCount(0);
  await expect(page.getByText("Nothing planned")).toHaveCount(0);

  const main = page.getByRole("main");
  await expect(main.getByRole("img", { name: "Squirrel mascot" })).toBeVisible();
  // One line on why it is worth using, and exactly one primary button.
  await expect(main.getByText("Squirrel works out what you still need to buy")).toBeVisible();
  const first = main.getByRole("button", { name: "Add your first dinner" });
  await expect(first).toBeVisible();
  await expect(first).toHaveClass(/(^|\s)bg-primary(\s|$)/);

  if (testInfo.project.name === "mobile") {
    await expectNoHorizontalOverflow(page);
  }
});

test("adding a meal to an empty day asks for the slot", async ({ page }, testInfo) => {
  const name = `Pancakes ${Date.now().toString(36)}`;
  await page.goto(`/dashboard/meal-planning?week=${addWeek(testInfo.project.name)}`);

  // UX-50: an empty week has no per-day cards; its one button opens the same
  // dialog, for the first open day.
  const first = page.getByRole("button", { name: "Add your first dinner" });
  await expectHydrated(first);
  await first.click();
  const dialog = page.getByRole("dialog", { name: /^Add \w+ · \w+ \d+$/ });
  await dialog.getByRole("combobox", { name: "Meal" }).click();
  await page.getByRole("option", { name: "Lunch" }).click();
  await dialog.getByRole("combobox", { name: "Recipe" }).click();
  await page.getByRole("option", { name: "Custom meal…" }).click();
  await dialog.getByRole("textbox", { name: "Meal name" }).fill(name);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();

  await expect(page.getByText(name)).toBeVisible();
  // The day lists its one meal and keeps a single "Add meal": no per-slot
  // rows for the three empty slots, and the six other days stay as they were.
  await expect(page.getByRole("button", { name: /^Add meal, / })).toHaveCount(7);
  await expect(page.getByRole("button", { name: /^(Breakfast|Lunch|Dinner|Snack) Add meal$/ })).toHaveCount(0);
  const meal = page.getByRole("button", { name: new RegExp(`^Lunch ${name}`) });
  await expect(meal).toBeVisible();
  if (testInfo.project.name === "mobile") {
    // M3: the meal row and the day's "Add meal" under it are 44 px targets
    // at least 8 px apart. Measured once the page behind the closed sheet
    // has scaled back to full size (UX-34, sheet-indent.tsx), not
    // mid-transition.
    await expect
      .poll(() => page.locator('[data-slot="sheet-indent"]').evaluate((el) => getComputedStyle(el).transform))
      .toBe("none");
    const row = await meal.boundingBox();
    const add = await page.getByRole("button", { name: /^Add meal, / }).first().boundingBox();
    expect(row!.height).toBeGreaterThanOrEqual(44);
    expect(add!.height).toBeGreaterThanOrEqual(44);
    expect(add!.y - (row!.y + row!.height)).toBeGreaterThanOrEqual(8);
  }
  await page.reload();
  // Scoped to main: see the reload in item-page.spec.ts.
  await expect(page.getByRole("main").getByText(name)).toBeVisible();
});

test("the planner has one control row with the rare actions in a menu", async ({ page }, testInfo) => {
  await page.goto(`/dashboard/meal-planning?week=${EMPTY_WEEK}`);

  // Previous, next and the ⋯ menu share one row, and the week range is in it.
  const prev = await page.getByRole("link", { name: "Previous week" }).boundingBox();
  const next = await page.getByRole("link", { name: "Next week" }).boundingBox();
  const more = page.getByRole("button", { name: "More planner actions" });
  const moreBox = await more.boundingBox();
  expect(Math.abs(prev!.y - next!.y)).toBeLessThan(2);
  // Centres, not tops: the switcher's "This week" link sits under the range
  // on another week, so the row is taller than the ⋯ button (UX-53).
  expect(Math.abs(prev!.y + prev!.height / 2 - (moreBox!.y + moreBox!.height / 2))).toBeLessThan(2);
  if (testInfo.project.name === "mobile") {
    // M3: 44 px targets with at least 8 px between neighbours.
    expect(prev!.width).toBeGreaterThanOrEqual(44);
    expect(next!.x - (prev!.x + prev!.width)).toBeGreaterThanOrEqual(8);
  }
  // Rare actions are not standing buttons any more.
  await expect(page.getByRole("button", { name: "Copy last week" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add missing ingredients to shopping list" })).toHaveCount(0);

  // The menu opens through React handlers, so a tap before hydration does
  // nothing (MAINT-34, as MAINT-27).
  await expectHydrated(more);
  await more.click();
  await expect(page.getByRole("menuitem", { name: "Copy last week" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Add missing ingredients to shopping list" }).click();
  await expect(page.getByRole("dialog", { name: "Add missing ingredients" })).toBeVisible();
});

test("the current week opens with today in view", async ({ page }) => {
  // UX-50: an empty week is one empty state with no day cards, so plan one
  // meal today first.
  await withCurrentWeekMeal(`view-${Date.now().toString(36)}`, async () => {
    await page.goto("/dashboard/meal-planning");

    await expect(page.locator("#meal-planner-today-card:visible")).toBeInViewport();
  });
});
