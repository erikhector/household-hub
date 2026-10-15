import { expect, test } from "@playwright/test";
import { dismissCookieNotice } from "./ui";

// MAINT-9: the recap cards share one useDismissedLocalStorage hook. This
// drives the tasks recap through it: dismissing hides it at once and the
// dismissal survives a reload (it is stored in localStorage, per browser).
test("the weekly task recap stays dismissed after a reload", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  const title = `Recap task ${Date.now().toString(36)}`;

  await page.goto("/dashboard/tasks");
  await page.getByRole("button", { name: "Add task" }).click();
  await page.getByRole("textbox", { name: "Task title" }).fill(title);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  // The checkbox flips optimistically, before the server has saved the
  // completion, so "checked" alone doesn't mean a reload will show it. Wait
  // for the Server Action's response first; reloading too early (as a loaded
  // machine did) shows an empty week with no recap. The row must be there
  // before listening: the add's own response can still be on its way, and
  // on a busy machine it was the one this caught, not the tick's.
  const box = page.getByRole("checkbox", { name: `Mark ${title} as done` });
  await expect(box).toBeVisible();
  await page.waitForLoadState("networkidle");
  const saved = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes("/dashboard/tasks"),
  );
  await box.click();
  await saved;
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as not done` })).toBeChecked();

  await page.reload();
  const recap = page.getByText("This week, the household handled:");
  await expect(recap).toBeVisible();

  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(recap).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as not done` })).toBeChecked();
  await expect(recap).toHaveCount(0);
});
