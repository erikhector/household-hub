import { expect, test } from "@playwright/test";
import { expectHydrated } from "./ui";

// UX-155: the five desktop inventory filters are named for a screen reader
// (not just their current value), matching the mobile Filters dialog, and
// the table's actions column has a header a screen reader can read.
test("desktop inventory filters and the actions column are labelled", async ({ page }) => {
  await page.goto("/dashboard/inventory");
  const main = page.getByRole("main");
  await expectHydrated(main.getByRole("combobox", { name: "Category", exact: true }));

  for (const name of ["Category", "Location", "Status", "Last updated", "Group by"]) {
    await expect(main.getByRole("combobox", { name, exact: true })).toBeVisible();
  }
  await expect(main.getByRole("columnheader", { name: "Actions", exact: true })).toBeAttached();
});
