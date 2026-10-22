import { expect, test } from "@playwright/test";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-53: the household budget, the personal budget and the meal planner page
// by period with one shared switcher: same arrow size and placement, the same
// accessible-name pattern, and a "This month" / "This week" jump that only
// shows when you're elsewhere.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

const switchers = [
  { path: "/dashboard/budget", away: "/dashboard/budget?month=2031-02", prev: "Previous month", next: "Next month", jump: "This month" },
  { path: "/dashboard/personal-budget", away: "/dashboard/personal-budget?month=2031-02", prev: "Previous month", next: "Next month", jump: "This month" },
  { path: "/dashboard/meal-planning", away: "/dashboard/meal-planning?week=2031-02-03", prev: "Previous week", next: "Next week", jump: "This week" },
];

for (const s of switchers) {
  test(`${s.path}: shared period switcher with a jump back`, async ({ page }) => {
    await page.goto(s.path);
    const main = page.getByRole("main");
    await expect(main.getByRole("link", { name: s.prev })).toBeVisible();
    await expect(main.getByRole("link", { name: s.next })).toBeVisible();
    // On the current period the jump would do nothing, so it isn't there.
    await expect(main.getByRole("link", { name: s.jump })).toHaveCount(0);

    // Same arrow size everywhere (the ghost icon-lg link of PeriodSwitcher).
    const prev = await main.getByRole("link", { name: s.prev }).boundingBox();
    expect(prev!.width).toBeGreaterThanOrEqual(36);
    expect(Math.round(prev!.width)).toBe(Math.round(prev!.height));

    await page.goto(s.away);
    await expect(main.getByRole("link", { name: s.jump })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await main.getByRole("link", { name: s.jump }).click();
    await expect(main.getByRole("link", { name: s.jump })).toHaveCount(0);
  });
}

test("the planner's switcher is as large as the budget's", async ({ page }) => {
  await page.goto("/dashboard/budget");
  const budget = await page.getByRole("main").getByRole("link", { name: "Previous month" }).boundingBox();
  await page.goto("/dashboard/meal-planning");
  const planner = await page.getByRole("main").getByRole("link", { name: "Previous week" }).boundingBox();
  expect(planner!.width).toBe(budget!.width);
  expect(planner!.height).toBe(budget!.height);
});
