import { expect, test } from "@playwright/test";
import { dismissCookieNotice } from "./ui";

// UX-107: the task title has a visible label, and a counter appears from 100
// characters so the 120 cap never silently cuts input.
test("task title is labelled and shows a counter from 100 characters", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await page.goto("/dashboard/tasks");
  await page.getByRole("button", { name: "Add task" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a task" });
  await expect(dialog.getByText("Task title", { exact: true })).toBeVisible();

  const field = dialog.getByRole("textbox", { name: "Task title" });
  await field.fill("a".repeat(99));
  await expect(dialog.getByRole("status")).toHaveCount(0);

  await field.fill("a".repeat(100));
  await expect(dialog.getByRole("status")).toHaveText("100 of 120 characters");

  await field.fill("a".repeat(130));
  await expect(field).toHaveValue("a".repeat(120));
  await expect(dialog.getByRole("status")).toHaveText("120 of 120 characters");
});
