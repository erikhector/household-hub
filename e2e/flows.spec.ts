import { expect, test } from "@playwright/test";
import { dismissCookieNotice, gotoRevealed } from "./ui";

// Core write paths through the real UI, server actions and database. Each
// test creates its own uniquely named data, so reruns against the same
// seeded household don't trip over rows an earlier run left behind.
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

// UX-4: the page's one primary action must carry visible words at every
// width. It used to collapse to a lone "+" below `sm`. Runs on both
// projects, so the mobile run checks the 412 px phone layout.
test("the Add task button shows its label", async ({ page }) => {
  // The button streams in its own Suspense boundary (tasks/page.tsx), and
  // React 19.2 batches the reveals: on the iphone project's first visit (a
  // cold WebKit, 11-13 s in CI) the skeleton could outlast the 5 s
  // toBeVisible below. gotoRevealed (e2e/ui.ts) waits for the reveal.
  await gotoRevealed(page, "/dashboard/tasks");
  const button = page.getByRole("button", { name: "Add task" });
  await expect(button).toBeVisible();
  await expect(button).toHaveText("Add task");
});

test("add a task and mark it done", async ({ page, context, baseURL }) => {
  // On a phone the cookie notice covers the floating primary action (UX-40).
  await dismissCookieNotice(context, baseURL!);
  const title = unique("Take out the bins");
  await page.goto("/dashboard/tasks");
  await page.getByRole("button", { name: "Add task" }).click();
  await page.getByRole("textbox", { name: "Task title" }).fill(title);
  await page.getByRole("button", { name: "Add", exact: true }).click();

  const done = page.getByRole("checkbox", { name: `Mark ${title} as done` });
  await expect(done).toBeVisible();
  // The toggle is optimistic (UX-14): the box and its "not done" label flip
  // on tap, before the save lands. Wait for the Server Action's response
  // (sent once the action has run) before reloading, or the reload can race
  // it.
  const saved = page.waitForResponse(
    (response) => response.request().method() === "POST" && "next-action" in response.request().headers(),
  );
  await done.click();

  // A done task moves to "Completed" and its checkbox flips to "not done".
  const notDone = page.getByRole("checkbox", { name: `Mark ${title} as not done` });
  await expect(notDone).toBeChecked();
  await saved;
  // Checked again after a reload, so it really reached the database.
  await page.reload();
  await expect(notDone).toBeChecked();
});

// PERF-21: next.config.ts keeps a visited page in the browser's client cache
// for 15 s (staleTimes.dynamic). The risk is a stale copy hiding the user's own
// edit, so add a task, leave the page by a client-side navigation (router.push
// keeps the cache, unlike goto or reload) and come back: the new task must be
// there, because the action's revalidatePath cleared the cached copy.
test("an edit still shows after navigating away and back", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  const title = unique("Cached page task");
  await gotoRevealed(page, "/dashboard/tasks");
  await page.getByRole("button", { name: "Add task" }).click();
  await page.getByRole("textbox", { name: "Task title" }).fill(title);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as done` })).toBeVisible();

  const push = (path: string) =>
    page.evaluate((to) => {
      (window as unknown as { next: { router: { push: (p: string) => void } } }).next.router.push(to);
    }, path);
  await push("/dashboard/profile");
  await expect(page).toHaveURL(/\/dashboard\/profile/);
  await push("/dashboard/tasks");
  await expect(page).toHaveURL(/\/dashboard\/tasks$/);
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as done` })).toBeVisible();
});

test("create a shopping list and add items to it", async ({ page, context, baseURL }) => {
  // On a phone the cookie notice covers the floating primary action (UX-40).
  await dismissCookieNotice(context, baseURL!);
  const name = unique("Weekly shop");
  await page.goto("/dashboard/shopping-list");
  await page.getByRole("button", { name: "New list" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await page.getByRole("button", { name: "Create list" }).click();

  await expect(page).toHaveURL(/\/dashboard\/shopping-list\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  // The add box takes a comma-separated batch (see its hint text).
  const addBox = page.getByRole("combobox", { name: "Add to the list" });
  await addBox.fill("milk, bread");
  await addBox.press("Enter");

  // Each item renders as a checkbox labelled "<name> × <qty> <unit>".
  // Wait for both before reloading: the add runs in a transition, and a
  // reload that races it drops the request.
  const milk = page.getByRole("checkbox", { name: /^milk\b/ });
  const bread = page.getByRole("checkbox", { name: /^bread\b/ });
  await expect(milk).toBeVisible();
  await expect(bread).toBeVisible();

  await page.reload();
  await expect(milk).toBeVisible();
  await expect(bread).toBeVisible();
});
