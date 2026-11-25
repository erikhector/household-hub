import { expect, test, type Page } from "@playwright/test";
import { unique, uniqueId, withDb } from "./db";
import { E2E_HOUSEHOLD } from "./seed";
import { dismissCookieNotice, expectHydrated, expectRouterPatched, waitForSheetClosed } from "./ui";

// GAP-87: a task can use up a pantry item. The task is linked to an item
// with 3 pcs from the Add sheet's "Uses up" picker; ticking it toasts what it
// used and the item page reads 2 pcs after a reload; un-ticking puts it back
// to 3 pcs.

const PREFIX = "e2e-uses-up";
let created: { taskTitle: string; itemId: string } | null = null;

// Only this household's rows: the task by its unique title, then the item
// (its stock events go with it, ON DELETE CASCADE).
test.afterEach(async () => {
  if (!created) return;
  const { taskTitle, itemId } = created;
  created = null;
  await withDb(async (client) => {
    await client.query(`DELETE FROM "HouseholdTask" WHERE "householdId" = $1 AND title = $2`, [E2E_HOUSEHOLD.id, taskTitle]);
    await client.query(`DELETE FROM "InventoryItem" WHERE "householdId" = $1 AND id = $2`, [E2E_HOUSEHOLD.id, itemId]);
  });
});

const quantityOf = (itemId: string) =>
  withDb(async (client) => {
    const { rows } = await client.query(`SELECT quantity FROM "InventoryItem" WHERE id = $1`, [itemId]);
    return rows[0].quantity as number;
  });

// Resolves once the tasks page's next Server Action (a tick's save) has
// answered. Set it up before the tap that sends one.
const toggleSaved = (page: Page) =>
  page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      "next-action" in r.request().headers() &&
      new URL(r.url()).pathname === "/dashboard/tasks",
  );

async function expectItemPageReads(page: Page, itemId: string, itemName: string, quantity: number) {
  await page.goto(`/dashboard/inventory/items/${itemId}`);
  const escaped = itemName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await expect(page.getByRole("main").getByRole("button", { name: new RegExp(`${escaped} \\(${quantity} `) })).toBeVisible();
}

test("a task linked to a pantry item uses it up on a tick and puts it back on an un-tick", async ({
  page,
  context,
  baseURL,
}) => {
  await dismissCookieNotice(context, baseURL!);
  const itemId = uniqueId(PREFIX);
  const itemName = unique("Dishwasher tablets");
  const taskTitle = unique("Run the dishwasher");
  created = { taskTitle, itemId };
  await withDb((client) =>
    client.query(
      `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "lowStockThreshold", "everStocked", "updatedAt")
       VALUES ($1, $2, $3, 'Cleaning', 3, 'pcs', 0.5, true, now())`,
      [itemId, E2E_HOUSEHOLD.id, itemName],
    ),
  );

  await page.goto("/dashboard/tasks");
  const add = page.getByRole("button", { name: "Add task" });
  await expectHydrated(add);
  await expectRouterPatched(page);
  await add.click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("textbox", { name: "Task title" }).fill(taskTitle);
  await sheet.getByRole("combobox", { name: "Uses up" }).fill(itemName);
  await page.getByRole("option", { name: itemName, exact: true }).click();
  // Picking an item starts the amount at 1, in the item's unit.
  await expect(sheet.getByRole("textbox", { name: "Amount each time" })).toHaveValue("1");
  await expect(sheet.getByText("pcs", { exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: "Add", exact: true }).click();
  const tick = page.getByRole("checkbox", { name: `Mark ${taskTitle} as done`, exact: true });
  await expect(tick).toBeVisible();
  await waitForSheetClosed(page);

  // Tick: the done toast names what was used, and the item reads 2 pcs.
  await expectHydrated(tick);
  const ticked = toggleSaved(page);
  await tick.click();
  await ticked;
  await expect(page.getByText(`Done: ${taskTitle}`)).toBeVisible();
  await expect(page.getByText(`Used 1 pcs ${itemName}`)).toBeVisible();
  await expect.poll(() => quantityOf(itemId)).toBe(2);
  await expectItemPageReads(page, itemId, itemName, 2);

  // Un-tick: the stock goes back to 3 pcs.
  await page.goto("/dashboard/tasks");
  const untick = page.getByRole("checkbox", { name: `Mark ${taskTitle} as not done`, exact: true });
  await expectHydrated(untick);
  const unticked = toggleSaved(page);
  await untick.click();
  await unticked;
  await expect.poll(() => quantityOf(itemId)).toBe(3);
  await expectItemPageReads(page, itemId, itemName, 3);
});
