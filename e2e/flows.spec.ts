import { expect, test } from "@playwright/test";

// Core write paths through the real UI, server actions and database. Each
// test creates its own uniquely named data, so reruns against the same
// seeded household don't trip over rows an earlier run left behind.
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

test("add a task and mark it done", async ({ page }) => {
  const title = unique("Take out the bins");
  await page.goto("/dashboard/tasks");
  await page.getByRole("button", { name: "Add task" }).click();
  await page.getByRole("textbox", { name: "Task title" }).fill(title);
  await page.getByRole("button", { name: "Add", exact: true }).click();

  const done = page.getByRole("checkbox", { name: `Mark ${title} as done` });
  await expect(done).toBeVisible();
  await done.click();

  // A done task moves to "Completed" and its checkbox flips to "not done".
  // The toggle isn't optimistic: the label comes from the server-rendered
  // task, so it only flips once the action has saved and revalidated. Wait
  // for that before reloading, or the reload can race the Server Action.
  const notDone = page.getByRole("checkbox", { name: `Mark ${title} as not done` });
  await expect(notDone).toBeChecked();
  // Checked again after a reload, so it really reached the database.
  await page.reload();
  await expect(notDone).toBeChecked();
});

test("create a shopping list and add items to it", async ({ page }) => {
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
