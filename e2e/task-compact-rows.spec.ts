import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD, E2E_MEMBER, E2E_MEMBER_SV } from "./seed";
import { E2E_WORKER, e2eWorkerData } from "./seed-data";
import { dismissCookieNotice, expectNoHorizontalOverflow, waitForUndoableDelete } from "./ui";

// UX-106: a task row is one line on a phone (at most 56 px with an assignee
// badge), with Edit and Delete in the swipe tray and the edit sheet rather
// than as icons or a ⋯; and the page remembers a "Mine / Everyone" choice.
const tag = () => `${E2E_WORKER}${Math.random().toString(36).slice(2, 7)}`;
const idPrefix = `e2e-ux106-${E2E_WORKER}-`;

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function seedTask(id: string, title: string, assignedToMemberId: string | null) {
  await withClient((client) =>
    client.query(`INSERT INTO "HouseholdTask" (id, "householdId", title, "assignedToMemberId") VALUES ($1, $2, $3, $4)`, [
      `${idPrefix}${id}`,
      E2E_HOUSEHOLD.id,
      title,
      assignedToMemberId,
    ]),
  );
}

// The signed-in user's name as it is now. Other specs in the same worker
// (one-primary-action, pending-button-width) rename this shared user through
// the profile form, so the seeded "E2E Tester" is only right when this spec
// happens to run first. That was why #437 passed locally and failed in CI,
// where the specs land on workers in a different order.
async function currentDisplayName(): Promise<string> {
  const { rows } = await withClient((client) =>
    client.query<{ displayName: string }>(`SELECT "displayName" FROM "User" WHERE id = $1`, [e2eWorkerData(E2E_WORKER).user.id]),
  );
  return rows[0].displayName;
}

// Only this household's rows: a cleanup by id prefix alone could delete
// another worker's rows mid-test.
test.afterAll(async () => {
  await withClient((client) =>
    client.query(`DELETE FROM "HouseholdTask" WHERE "householdId" = $1 AND id LIKE $2`, [E2E_HOUSEHOLD.id, `${idPrefix}%`]),
  );
});

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("a phone task row with an assignee is one line of at most 56 px, with Delete in the edit sheet", async ({ page }) => {
  test.skip(test.info().project.name !== "mobile", "the compact row is the phone layout");
  const t = tag();
  const title = `Wipe the hob ${t}`;
  await seedTask(`row-${t}`, title, E2E_MEMBER);
  const assignee = await currentDisplayName();
  await page.goto("/dashboard/tasks");

  const box = page.getByRole("checkbox", { name: `Mark ${title} as done` });
  await expect(box).toBeVisible();
  // The checkbox's parent is the bordered row.
  const row = box.locator("..");
  await expect(row.getByText(assignee, { exact: true })).toBeVisible();
  const height = (await row.boundingBox())!.height;
  expect(height).toBeLessThanOrEqual(56);
  await expectNoHorizontalOverflow(page);

  // Neither action is a second button on the row (the swipe tray has both).
  await expect(page.getByRole("button", { name: `More actions for ${title}` })).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Edit ${title}`, exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: `Delete ${title}`, exact: true })).toBeHidden();

  // The visible path: the title opens the edit sheet, which has Delete.
  await page.getByRole("main").getByRole("button", { name: title, exact: true }).click();
  const sheet = page.getByRole("dialog", { name: `Edit "${title}"` });
  await expect(sheet.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: "Delete", exact: true }).click();
  // UX-49: no confirm; the row goes at once with an Undo toast.
  await expect(box).toBeHidden();
  await waitForUndoableDelete(page, `Deleted "${title}"`);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Tasks" }).first()).toBeVisible();
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);
});

test("a desktop task row keeps its Edit and Delete icons", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "the icons are the sm-and-up layout");
  const t = tag();
  const title = `Sweep the hall ${t}`;
  await seedTask(`icons-${t}`, title, null);
  await page.goto("/dashboard/tasks");
  await expect(page.getByRole("button", { name: `Edit ${title}`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Delete ${title}`, exact: true })).toBeVisible();
});

test("Mine shows only my tasks, and the choice is remembered", async ({ page }) => {
  const t = tag();
  const mine = `Mine ${t}`;
  const theirs = `Theirs ${t}`;
  const nobody = `Nobody ${t}`;
  await seedTask(`mine-${t}`, mine, E2E_MEMBER);
  await seedTask(`theirs-${t}`, theirs, E2E_MEMBER_SV);
  await seedTask(`nobody-${t}`, nobody, null);
  await page.goto("/dashboard/tasks");

  const main = page.getByRole("main");
  const everyone = main.getByRole("button", { name: "Everyone", exact: true });
  const onlyMine = main.getByRole("button", { name: "Mine", exact: true });
  await expect(everyone).toHaveAttribute("aria-pressed", "true");
  for (const title of [mine, theirs, nobody]) await expect(main.getByText(title, { exact: true })).toBeVisible();

  await onlyMine.click();
  await expect(onlyMine).toHaveAttribute("aria-pressed", "true");
  await expect(main.getByText(mine, { exact: true })).toBeVisible();
  await expect(main.getByText(theirs, { exact: true })).toHaveCount(0);
  await expect(main.getByText(nobody, { exact: true })).toHaveCount(0);

  // Remembered across a reload.
  await page.reload();
  await expect(main.getByRole("button", { name: "Mine", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(main.getByText(mine, { exact: true })).toBeVisible();
  await expect(main.getByText(theirs, { exact: true })).toHaveCount(0);

  await main.getByRole("button", { name: "Everyone", exact: true }).click();
  await expect(main.getByText(theirs, { exact: true })).toBeVisible();
  await expect(main.getByText(nobody, { exact: true })).toBeVisible();
});
