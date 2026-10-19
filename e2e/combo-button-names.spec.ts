import { expect, test } from "@playwright/test";
import { dismissCookieNotice } from "./ui";

// UX-129: a combo field's × and chevron were unnamed, so a screen reader
// announced just "button" twice per field. Each is now named after its
// field ("Clear unit") or its job ("Show suggestions"). On phones only one
// of the pair shows at a time, so the test follows the field's state.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("combo field buttons are named", async ({ page }) => {
  await page.goto("/dashboard/inventory");
  await page.getByRole("main").getByRole("button", { name: "Add item", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add inventory item" });
  const unit = dialog.getByLabel("Unit", { exact: true });

  await unit.fill("");
  await expect(dialog.getByRole("button", { name: "Show suggestions" }).first()).toBeVisible();

  await unit.fill("pcs");
  // The open suggestion list hides the rest of the dialog from assistive
  // tech, so close it (click a label elsewhere) before asking for the buttons.
  await dialog.getByText("Category", { exact: true }).click();
  const clear = dialog.getByRole("button", { name: "Clear unit" });
  await expect(clear).toBeVisible();
  // The generic matcher the backlog item names finds the same button.
  await expect(dialog.getByRole("button", { name: /clear/i }).first()).toBeVisible();

  await clear.click();
  await expect(unit).toHaveValue("");
});
