import { expect, test } from "@playwright/test";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-5: an empty slot in the weekly planner is one "<slot> + Add meal" row,
// not a label, a repeated "Nothing planned" line and a tiny "+" button, so an
// empty week isn't a wall of identical text on a phone. The household is
// shared by the desktop and mobile runs, so each test uses a far-future week
// nobody else plans in; the add test picks its own per project, since a
// meal added by the first run would make its slot non-empty for the second.
const EMPTY_WEEK = "2031-01-06";
const addWeek = (project: string) => (project === "mobile" ? "2031-01-20" : "2031-01-13");

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("an empty week shows one add row per slot and no repeated placeholder", async ({ page }, testInfo) => {
  await page.goto(`/dashboard/meal-planning?week=${EMPTY_WEEK}`);

  const addRows = page.getByRole("button", { name: /^(Breakfast|Lunch|Dinner|Snack) Add meal$/ });
  // 7 days x 4 slots, each exactly one affordance.
  await expect(addRows).toHaveCount(28);
  await expect(page.getByText("Nothing planned")).toHaveCount(0);

  if (testInfo.project.name === "mobile") {
    // The whole empty week used to be ~7,200 px tall; it must now be well
    // under half of that.
    const first = await addRows.first().boundingBox();
    const last = await addRows.last().boundingBox();
    expect(last!.y + last!.height - first!.y).toBeLessThan(3600);
    await expectNoHorizontalOverflow(page);
  }
});

test("adding a meal to an empty slot still works", async ({ page }, testInfo) => {
  const name = `Pancakes ${Date.now().toString(36)}`;
  await page.goto(`/dashboard/meal-planning?week=${addWeek(testInfo.project.name)}`);

  await page.getByRole("button", { name: "Breakfast Add meal" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add a meal" });
  await dialog.getByRole("textbox", { name: "Meal name" }).fill(name);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();

  await expect(page.getByText(name)).toBeVisible();
  // The slot now holds an entry, so it is no longer an empty add row, and the
  // other 27 slots still are.
  await expect(page.getByRole("button", { name: /^(Breakfast|Lunch|Dinner|Snack) Add meal$/ })).toHaveCount(27);
  await page.reload();
  // Scoped to main: see the reload in item-page.spec.ts.
  await expect(page.getByRole("main").getByText(name)).toBeVisible();
});
