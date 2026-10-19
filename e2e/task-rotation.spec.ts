import { expect, test } from "@playwright/test";
import { dismissCookieNotice } from "./ui";

// UX-103: "Take turns" with one person used to save with no rotation and no
// message. The assignee now seeds the turn order as #1, and a one-person
// rotation can't be submitted.
test("take turns starts from the assignee and blocks a one-person rotation", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await page.goto("/dashboard/tasks");
  await page.getByRole("button", { name: "Add task" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Task title" }).fill(`Rotate ${Date.now().toString(36)}`);

  // Assign to the first member, then make the task repeat.
  await dialog.getByRole("combobox", { name: "Assign to" }).click();
  await page.getByRole("option").first().click();
  await dialog.getByRole("combobox", { name: "Repeat" }).click();
  await page.getByRole("option").nth(1).click();

  // Picking one more person gives a two-person rotation with the assignee first.
  await dialog.getByRole("combobox", { name: "Take turns" }).click();
  await page.getByRole("option").first().click();
  const rows = dialog.getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("1.");
  await expect(dialog.getByRole("button", { name: "Add", exact: true })).toBeEnabled();

  // Removing one leaves a lone person: the hint shows as an error, Add is off.
  await rows.nth(1).getByRole("button", { name: /^Remove / }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Add at least one more person to take turns.");
  await expect(dialog.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
});
