import { expect, test } from "@playwright/test";
import { dismissCookieNotice, expectHydrated, expectRouterPatched, waitForDialogHistory } from "./ui";

// UX-101: tapping a task's title opens its edit dialog and never completes
// it. Only the checkbox (or the right swipe, covered in swipe-rows) does.
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

test("tapping a task's title opens the edit dialog without completing it", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  const title = unique("Wipe the counters");
  await page.goto("/dashboard/tasks");
  const add = page.getByRole("button", { name: "Add task" });
  // MAINT-67: the Add sheet's history entry must land after Next patches
  // history, or the router's first commit rewrites it under the sheet.
  await expectHydrated(add);
  await expectRouterPatched(page);
  await add.click();
  await page.getByRole("textbox", { name: "Task title" }).fill(title);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const box = page.getByRole("checkbox", { name: `Mark ${title} as done` });
  await expect(box).toBeVisible();

  // MAINT-93: the new row shows while the Add sheet is still closing and its
  // history.back() is still on its way (dialog-history.ts). A title tap in
  // that window opens the edit sheet on a history that hasn't settled, and on
  // a loaded phone run it never showed within 5 s. Wait for the Add sheet to
  // be gone and its back() to land, and for React to own the title button,
  // so the tap opens the edit sheet the way a person's later tap would.
  await waitForDialogHistory(page);
  const titleButton = page.getByRole("main").getByRole("button", { name: title, exact: true });
  await expectHydrated(titleButton);
  await titleButton.click();
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
