import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { clickRowAction, dismissCookieNotice, waitForUndoableDelete } from "./ui";

// UX-49: an everyday delete (task, shopping item, inventory item) goes at
// once and shows the same Undo toast, whichever way it was started: no
// "This can't be undone" confirm. Archiving a list says so and offers Undo,
// and Archive and Delete are no longer two lookalike icons side by side.
// (Meals, transactions, recipes and the item page are asserted in their own
// specs, which delete through the same toast.)

const tag = () => `${Date.now().toString(36)}-w${E2E_WORKER}`;

async function sql(text: string, values: unknown[] = []) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(text, values);
  } finally {
    await client.end();
  }
}

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 640;

test("deleting a task removes it at once with an Undo, and Undo brings it back", async ({ page }) => {
  const t = tag();
  const title = `Polish brass ${t}`;
  await sql(`INSERT INTO "HouseholdTask" (id, "householdId", title) VALUES ($1, $2, $3)`, [
    `e2e-ux49-task-${t}`,
    E2E_HOUSEHOLD.id,
    title,
  ]);
  await page.goto("/dashboard/tasks");
  const checkbox = page.getByRole("checkbox", { name: `Mark ${title} as done` });
  await expect(checkbox).toBeVisible();

  const remove = async () => {
    if (isPhone(page)) {
      await page.getByRole("main").getByRole("button", { name: title, exact: true }).click();
      await page.getByRole("dialog", { name: `Edit "${title}"` }).getByRole("button", { name: "Delete", exact: true }).click();
    } else {
      await page.getByRole("button", { name: `Delete ${title}`, exact: true }).click();
    }
  };

  await remove();
  await expect(checkbox).toHaveCount(0);
  await expect(page.getByText(`Deleted "${title}"`)).toBeVisible();
  await expect(page.getByText("This can't be undone.")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(checkbox).toBeVisible();
  // Undo means nothing ever reached the server.
  await page.reload();
  await expect(checkbox).toBeVisible();

  await remove();
  await waitForUndoableDelete(page, `Deleted "${title}"`);
  await expect
    .poll(async () => {
      await page.reload();
      return checkbox.count();
    })
    .toBe(0);
});

test("deleting a shopping item removes it at once with an Undo", async ({ page }) => {
  const t = tag();
  const name = `Oat milk ${t}`;
  const listId = `e2e-ux49-list-${t}`;
  await sql(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, $3)`, [
    listId,
    E2E_HOUSEHOLD.id,
    `Undo ${t}`,
  ]);
  for (const [i, itemName] of [name, `Left ${t}`].entries()) {
    await sql(`INSERT INTO "ShoppingListItem" (id, "shoppingListId", name) VALUES ($1, $2, $3)`, [
      `e2e-ux49-item-${t}-${i}`,
      listId,
      itemName,
    ]);
  }
  await page.goto(`/dashboard/shopping-list/${listId}`);
  const row = page.getByRole("checkbox", { name: new RegExp(name) });
  await expect(row).toBeVisible();

  await clickRowAction(page, { button: `Remove ${name}`, menu: `More actions for ${name}`, item: "Delete" });
  await expect(row).toHaveCount(0);
  await expect(page.getByText(`Deleted "${name}"`)).toBeVisible();
  await expect(page.getByText("This can't be undone.")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(row).toBeVisible();

  await clickRowAction(page, { button: `Remove ${name}`, menu: `More actions for ${name}`, item: "Delete" });
  await waitForUndoableDelete(page, `Deleted "${name}"`);
  await expect
    .poll(async () => {
      await page.reload();
      return row.count();
    })
    .toBe(0);
});

test("deleting an inventory item removes it at once with an Undo", async ({ page }) => {
  const t = tag();
  const name = `Basmati ${t}`;
  await sql(
    `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "updatedAt")
     VALUES ($1, $2, $3, 'Pantry', 2, 'pcs', now())`,
    [`e2e-ux49-inv-${t}`, E2E_HOUSEHOLD.id, name],
  );
  await page.goto("/dashboard/inventory");
  const search = page.getByRole("searchbox").filter({ visible: true });
  await expect(search).toHaveCount(1);
  await search.fill(name);
  const visibleName = page.getByRole("main").getByText(name, { exact: true }).filter({ visible: true });
  await expect(visibleName).toBeVisible();

  const remove = async () => {
    if (isPhone(page)) {
      await page.getByRole("main").getByRole("button", { name: "More actions", exact: true }).filter({ visible: true }).click();
      await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    } else {
      await page.getByRole("main").getByRole("button", { name: "Delete item", exact: true }).filter({ visible: true }).click();
    }
  };

  await remove();
  await expect(visibleName).toHaveCount(0);
  await expect(page.getByText(`Deleted "${name}"`)).toBeVisible();
  await expect(page.getByText("This can't be undone.")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(visibleName).toBeVisible();

  await remove();
  await waitForUndoableDelete(page, `Deleted "${name}"`);
  await expect
    .poll(async () => {
      await page.reload();
      await page.getByRole("searchbox").filter({ visible: true }).fill(name);
      return visibleName.count();
    })
    .toBe(0);
});

test("archiving a list says so with an Undo, and Archive and Delete share one menu", async ({ page }) => {
  const t = tag();
  const listId = `e2e-ux49-archive-${t}`;
  const name = `Archive me ${t}`;
  await sql(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, $3)`, [listId, E2E_HOUSEHOLD.id, name]);
  await page.goto("/dashboard/shopping-list");
  const card = page.locator(`[data-flip-key="${listId}"]`);
  await expect(card).toBeVisible();

  // No pair of icons: the card has one ⋯, and Archive and Delete are in it.
  await expect(card.getByRole("button", { name: "Archive list" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Delete list" })).toHaveCount(0);
  const more = card.getByRole("button", { name: "More list actions" });
  await more.click();
  await expect(page.getByRole("menuitem", { name: "Delete", exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();

  await expect(page.getByText("List archived")).toBeVisible();
  await expect(card.getByText("Archived", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(card.getByText("Archived", { exact: true })).toHaveCount(0);
  await expect(card.getByText(/to buy|Nothing/)).toBeVisible();

  // Delete still asks first: it takes the list's items with it.
  await card.getByRole("button", { name: "More list actions" }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("dialog", { name: `Delete ${name}?` })).toBeVisible();
});
