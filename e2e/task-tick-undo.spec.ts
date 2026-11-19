import { expect, test, type Page } from "@playwright/test";
import { dismissCookieNotice, expectHydrated, expectRouterPatched, waitForSheetClosed } from "./ui";

// UX-104: ticking a task says so and offers Undo (the row leaves for
// "Completed" below the fold), the weekly recap never appears or grows under
// the thumb during a tap, and ticking the last open task shows the
// "all caught up" moment.
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

// MAINT-116: each test ticks straight after adding its task, and twice in a
// full run's locked gate that first tick on the phone went nowhere (the task
// stayed open, or the caught-up loop found one open row more than it
// expected). Adding goes through a sheet: on a phone the page behind it is
// drawn at 0.94 (sheet-indent.tsx) and eases back to full size over 400 ms
// once it closes, and the close takes its history entry off with an async
// back() (dialog-history.ts). A tap whose press and release straddle a frame
// of that ease is released off the checkbox (waitForSheetClosed in ui.ts),
// and only a loaded runner is slow enough for that. So the sheet must be
// fully gone, and the page at rest, before anything is ticked.
async function addTask(page: Page, title: string) {
  const add = page.getByRole("button", { name: "Add task" });
  // The sheet pushes a history entry as it opens: before hydration the tap
  // does nothing, and before the router's patch its first commit closes the
  // sheet again (MAINT-68).
  await expectHydrated(add);
  await expectRouterPatched(page);
  await add.click();
  await page.getByRole("textbox", { name: "Task title" }).fill(title);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as done` })).toBeVisible();
  await waitForSheetClosed(page);
}

// A row's checkbox, once React owns it: a tap that lands before hydration is
// a bare browser toggle that hydration resets, with no save sent.
async function hydratedCheckbox(page: Page, name: string) {
  const box = page.getByRole("checkbox", { name, exact: true });
  await expectHydrated(box);
  return box;
}

// Resolves once the tasks page's next Server Action (a tick's save) has
// answered. Set it up before the tap that sends one.
const toggleSaved = (page: Page) =>
  page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      "next-action" in r.request().headers() &&
      new URL(r.url()).pathname === "/dashboard/tasks",
  );

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("a tick toasts Done with Undo, and Undo reopens the task", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  const title = unique("Water the plants");
  await page.goto("/dashboard/tasks");
  await addTask(page, title);

  const recap = page.getByRole("main").getByText("This week, the household handled:");
  const recapBefore = await recap.count();

  await (await hydratedCheckbox(page, `Mark ${title} as done`)).click();
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
  const tickSaved = toggleSaved(page);
  await (await hydratedCheckbox(page, `Mark ${title} as done`)).click();
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as not done` })).toBeChecked();
  await tickSaved;
  const untickSaved = toggleSaved(page);
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

  // The worker's household collects other specs' open tasks, and the moment
  // needs them all closed first. They're closed one at a time, each save
  // awaited, and only they are counted: ours stays out of the count, so a
  // tap on it can't hide inside it.
  const others = page.getByRole("checkbox", {
    name: new RegExp(`^Mark (?!${escapeRegExp(title)} as done$).* as done$`),
  });
  while ((await others.count()) > 0) {
    const before = await others.count();
    await expectHydrated(others.first());
    const saved = toggleSaved(page);
    await others.first().click();
    await saved;
    await expect(others).toHaveCount(before - 1);
  }
  await expect(page.getByRole("checkbox", { name: /^Mark .* as done$/ })).toHaveCount(1);
  await expect(page.getByText("You're all caught up!")).toHaveCount(0);
  // Ours is the last open task, so its tick clears the list.
  await (await hydratedCheckbox(page, `Mark ${title} as done`)).click();
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
