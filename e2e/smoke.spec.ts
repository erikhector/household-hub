import { expect, test } from "@playwright/test";

// Every top-level dashboard page must render without hitting an error
// boundary or logging a client-side error. Cheap, broad coverage: it's the
// first thing to catch a page an autonomous change broke without touching
// its tests.
const ROUTES = [
  "/dashboard",
  "/dashboard/inventory",
  "/dashboard/shopping-list",
  "/dashboard/meal-planning",
  "/dashboard/tasks",
  "/dashboard/budget",
  "/dashboard/personal-budget",
  "/dashboard/household",
  "/dashboard/notifications",
  "/dashboard/profile",
  "/dashboard/whats-new",
];

for (const route of ROUTES) {
  test(`${route} renders cleanly`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    const response = await page.goto(route);
    expect(response?.status(), `HTTP status for ${route}`).toBeLessThan(400);
    await expect(page).toHaveURL(new RegExp(`${route}$`));
    await expect(page.locator("main")).toBeVisible();
    // The app-level error boundary (src/app/error.tsx) replaces the page on
    // a render crash; its title is the tell.
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    expect(errors, `console/page errors on ${route}`).toEqual([]);
  });
}
