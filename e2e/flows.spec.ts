import { expect, test } from "@playwright/test";
import { dismissCookieNotice } from "./ui";

// Core write paths through the real UI, server actions and database. Each
// test creates its own uniquely named data, so reruns against the same
// seeded household don't trip over rows an earlier run left behind.
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

// UX-4: the page's one primary action must carry visible words at every
// width. It used to collapse to a lone "+" below `sm`. Runs on both
// projects, so the mobile run checks the 412 px phone layout.
test("the Add task button shows its label", async ({ page }) => {
  await page.goto("/dashboard/tasks");
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
  const milk = page.getByRole("checkbox", { name: /^milk ×/ });
  const bread = page.getByRole("checkbox", { name: /^bread ×/ });
  await expect(milk).toBeVisible();
  await expect(bread).toBeVisible();

  await page.reload();
  await expect(milk).toBeVisible();
  await expect(bread).toBeVisible();
});
