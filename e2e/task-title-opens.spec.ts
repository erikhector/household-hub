import { expect, test } from "@playwright/test";
import { dismissCookieNotice } from "./ui";

// UX-101: tapping a task's title opens its edit dialog and never completes
// it. Only the checkbox (or the right swipe, covered in swipe-rows) does.
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

test("tapping a task's title opens the edit dialog without completing it", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  const title = unique("Wipe the counters");
  await page.goto("/dashboard/tasks");
  await page.getByRole("button", { name: "Add task" }).click();
  await page.getByRole("textbox", { name: "Task title" }).fill(title);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const box = page.getByRole("checkbox", { name: `Mark ${title} as done` });
  await expect(box).toBeVisible();

  await page.getByRole("main").getByRole("button", { name: title, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Edit "${title}"` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Task title" })).toHaveValue(title);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Still open: no tick, no "Done" toast.
  await expect(box).not.toBeChecked();
  await expect(page.getByText(`Done: ${title}`)).toHaveCount(0);

  await box.click();
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as not done` })).toBeChecked();
});
