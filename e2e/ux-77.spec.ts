import { expect, test } from "@playwright/test";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-77: the seeded user has exactly one household, which the server refuses
// to delete. The danger zone says so inline and points at "Delete account"
// instead of offering a red button that opens a refusal.
test("only household: danger zone explains the rule and links to Delete account", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await page.goto("/dashboard/household");

  await expect(page.getByRole("heading", { name: "Danger zone" })).toBeVisible();
  await expect(page.getByText(/This is your only household/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete household" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.getByRole("link", { name: "Go to Delete account" }).click();
  await expect(page).toHaveURL(/\/dashboard\/profile/);
});
