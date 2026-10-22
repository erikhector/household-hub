import { expect, test } from "@playwright/test";
import { dismissCookieNotice } from "./ui";

// UX-127: the unit field holds "pcs" from the start, which used to filter the
// list down to "pcs" and hid the chevron on phones. One tap on the field now
// shows the common units, and a household with no stock of "dl" still gets it.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("one tap on a filled unit field lists the common units", async ({ page }) => {
  await page.goto("/dashboard/inventory");
  await page.getByRole("main").getByRole("button", { name: "Add item", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add inventory item" });
  const unit = dialog.getByLabel("Unit", { exact: true });
  await expect(unit).toHaveValue("pcs");

  await unit.click();
  for (const name of ["pcs", "g", "kg", "dl", "l", "förp"]) {
    await expect(page.getByRole("option", { name, exact: true })).toBeVisible();
  }

  await page.getByRole("option", { name: "dl", exact: true }).click();
  await expect(unit).toHaveValue("dl");
});
