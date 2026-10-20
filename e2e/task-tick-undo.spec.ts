import { expect, test } from "@playwright/test";
import { dismissCookieNotice } from "./ui";

// UX-104: ticking a task says so and offers Undo (the row leaves for
// "Completed" below the fold), the weekly recap never appears or grows under
// the thumb during a tap, and ticking the last open task shows the
// "all caught up" moment.
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

async function addTask(page: import("@playwright/test").Page, title: string) {
  await page.getByRole("button", { name: "Add task" }).click();
  await page.getByRole("textbox", { name: "Task title" }).fill(title);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as done` })).toBeVisible();
}

test("a tick toasts Done with Undo, and Undo reopens the task", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  const title = unique("Water the plants");
  await page.goto("/dashboard/tasks");
  await addTask(page, title);

  const recap = page.getByRole("main").getByText("This week, the household handled:");
  const recapBefore = await recap.count();

  await page.getByRole("checkbox", { name: `Mark ${title} as done` }).click();
  await expect(page.getByText(`Done: ${title}`)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as not done` })).toBeChecked();
  // The recap neither mounts nor grows during the tap.
  expect(await recap.count()).toBe(recapBefore);

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as done` })).not.toBeChecked();
});

// UX-102: an accidental tick and untick must not leave a "Last done by" on a
// task nobody has ever done, even after the page reloads from the database.
test("ticking then unticking a never-done task leaves no 'Last done by'", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  const title = unique("Wipe the shelves");
  await page.goto("/dashboard/tasks");
  await addTask(page, title);
  // Other seeded tasks may carry a "Last done by"; ours must not add one.
  const lastDone = page.getByText(/Last done by/);
  const before = await lastDone.count();

  // The tick is optimistic: the checkbox flips before the save lands, so
  // the reload below must wait for both toggles' responses. Reloading with
  // the untick still in flight aborts it, the task comes back done (under
  // "Completed", named "as not done"), and the lookup times out.
  const toggleSaved = () =>
    page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        "next-action" in r.request().headers() &&
        new URL(r.url()).pathname === "/dashboard/tasks",
    );
  const tickSaved = toggleSaved();
  await page.getByRole("checkbox", { name: `Mark ${title} as done` }).click();
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as not done` })).toBeChecked();
  await tickSaved;
  const untickSaved = toggleSaved();
  await page.getByRole("checkbox", { name: `Mark ${title} as not done` }).click();
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as done` })).not.toBeChecked();
  await untickSaved;

  await page.reload();
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as done` })).not.toBeChecked();
  await expect(lastDone).toHaveCount(before);
});

test("ticking the last open task shows the all-caught-up moment", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  const title = unique("Fold the laundry");
  await page.goto("/dashboard/tasks");
  await addTask(page, title);

  const open = page.getByRole("checkbox", { name: /^Mark .* as done$/ });
  // Tick every open task, newest last; the final tick clears the list.
  while ((await open.count()) > 1) {
    const before = await open.count();
    await open.first().click();
    await expect(open).toHaveCount(before - 1);
  }
  await expect(page.getByText("You're all caught up!")).toHaveCount(0);
  await open.first().click();
  await expect(page.getByText("You're all caught up!")).toBeVisible();
  await expect(page.getByRole("img", { name: "Squirrel mascot" }).first()).toBeVisible();

  // Undo brings the task back, so the moment goes with it.
  // The tick of our own task is the newest toast, so the front of the stack:
  // the earlier ticks' toasts pile behind it and a `.last()` Undo can sit
  // under another toast, which swallows the click.
  await page
    .locator("[data-sonner-toast]")
    .filter({ hasText: `Done: ${title}` })
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await expect(page.getByText("You're all caught up!")).toHaveCount(0);
});
