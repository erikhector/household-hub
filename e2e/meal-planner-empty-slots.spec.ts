import { expect, test } from "@playwright/test";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-5 / UX-21: a day with nothing planned in the weekly planner is one
// "+ Add meal" button that asks for the slot, not four "<slot> + Add meal"
// rows, a "Nothing planned" line and a tiny "+" button, so an empty week isn't
// a wall of identical text on a phone. The household is shared by the desktop
// and mobile runs, so each test uses a far-future week nobody else plans in;
// the add test picks its own per project, since a meal added by the first run
// would make its day non-empty for the second.
const EMPTY_WEEK = "2031-01-06";
const addWeek = (project: string) => (project === "mobile" ? "2031-01-20" : "2031-01-13");

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("an empty week shows one add button per day and no repeated placeholder", async ({ page }, testInfo) => {
  await page.goto(`/dashboard/meal-planning?week=${EMPTY_WEEK}`);

  const addButtons = page.getByRole("button", { name: "Add meal", exact: true });
  // One affordance per empty day, no per-slot rows.
  await expect(addButtons).toHaveCount(7);
  await expect(page.getByRole("button", { name: /^(Breakfast|Lunch|Dinner|Snack) Add meal$/ })).toHaveCount(0);
  await expect(page.getByText("Nothing planned")).toHaveCount(0);

  if (testInfo.project.name === "mobile") {
    // The empty week used to be ~7,200 px tall, then ~3,600 px with one row
    // per slot; with one button per day it must be under a third of that.
    const first = await addButtons.first().boundingBox();
    const last = await addButtons.last().boundingBox();
    expect(last!.y + last!.height - first!.y).toBeLessThan(1200);
    await expectNoHorizontalOverflow(page);
  }
});

test("adding a meal to an empty day asks for the slot", async ({ page }, testInfo) => {
  const name = `Pancakes ${Date.now().toString(36)}`;
  await page.goto(`/dashboard/meal-planning?week=${addWeek(testInfo.project.name)}`);

  await page.getByRole("button", { name: "Add meal", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add a meal" });
  await dialog.getByRole("combobox", { name: "Meal" }).click();
  await page.getByRole("option", { name: "Lunch" }).click();
  await dialog.getByRole("textbox", { name: "Meal name" }).fill(name);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();

  await expect(page.getByText(name)).toBeVisible();
  // The day now shows its slots: Lunch holds the entry, the other three are
  // still empty add rows, and the six other days stay collapsed.
  await expect(page.getByRole("button", { name: /^(Breakfast|Dinner|Snack) Add meal$/ })).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Lunch Add meal" })).toHaveCount(0);
  if (testInfo.project.name === "mobile") {
    // M3: neighbouring 44 px targets are at least 8 px apart, so the slot
    // add rows of a day with entries don't sit shoulder to shoulder.
    // Measured once the page behind the closed sheet has scaled back to
    // full size (UX-34, sheet-indent.tsx), not mid-transition.
    await expect
      .poll(() => page.locator('[data-slot="sheet-indent"]').evaluate((el) => getComputedStyle(el).transform))
      .toBe("none");
    const breakfast = await page.getByRole("button", { name: "Breakfast Add meal" }).boundingBox();
    const dinner = await page.getByRole("button", { name: "Dinner Add meal" }).boundingBox();
    expect(breakfast!.height).toBeGreaterThanOrEqual(44);
    expect(dinner!.y - (breakfast!.y + breakfast!.height)).toBeGreaterThanOrEqual(8);
  }
  await page.reload();
  // Scoped to main: see the reload in item-page.spec.ts.
  await expect(page.getByRole("main").getByText(name)).toBeVisible();
});

test("the planner has one control row with the rare actions in a menu", async ({ page }, testInfo) => {
  await page.goto(`/dashboard/meal-planning?week=${EMPTY_WEEK}`);

  // Previous, next and the ⋯ menu share one row, and the week range is in it.
  const prev = await page.getByRole("button", { name: "Previous week" }).boundingBox();
  const next = await page.getByRole("button", { name: "Next week" }).boundingBox();
  const more = page.getByRole("button", { name: "More planner actions" });
  const moreBox = await more.boundingBox();
  expect(Math.abs(prev!.y - next!.y)).toBeLessThan(2);
  expect(Math.abs(prev!.y - moreBox!.y)).toBeLessThan(2);
  if (testInfo.project.name === "mobile") {
    // M3: 44 px targets with at least 8 px between neighbours.
    expect(prev!.width).toBeGreaterThanOrEqual(44);
    expect(next!.x - (prev!.x + prev!.width)).toBeGreaterThanOrEqual(8);
  }
  // Rare actions are not standing buttons any more.
  await expect(page.getByRole("button", { name: "Copy last week" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add missing ingredients to shopping list" })).toHaveCount(0);

  await more.click();
  await expect(page.getByRole("menuitem", { name: "Copy last week" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Add missing ingredients to shopping list" }).click();
  await expect(page.getByRole("dialog", { name: "Add missing ingredients" })).toBeVisible();
});

test("the current week opens with today in view", async ({ page }) => {
  await page.goto("/dashboard/meal-planning");

  await expect(page.locator("#meal-planner-today-card:visible")).toBeInViewport();
});
