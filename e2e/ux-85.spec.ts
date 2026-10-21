import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { en } from "@/lib/i18n/dictionaries/en";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice } from "./ui";

// UX-85: rename a list (⋯ menu and the pencil by its title), start a new
// list from a template or a recent list (unbought or all items), and the
// template rows say "Use". Rows are written straight to Postgres, named
// uniquely, and only this worker's household is touched.
const tag = () => `${Date.now().toString(36)}-w${E2E_WORKER}`;
const d = en.shoppingList;

async function sql<T = never>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(text, values)).rows as T[];
  } finally {
    await client.end();
  }
}

async function seedList(t: string, name: string, items: { name: string; purchased: boolean }[]) {
  const listId = `e2e-ux85-list-${t}-${name.length}`;
  await sql(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, $3)`, [
    listId,
    E2E_HOUSEHOLD.id,
    name,
  ]);
  for (const [i, item] of items.entries()) {
    await sql(
      `INSERT INTO "ShoppingListItem" (id, "shoppingListId", name, unit, purchased) VALUES ($1, $2, $3, 'pcs', $4)`,
      [`e2e-ux85-item-${t}-${listId}-${i}`, listId, item.name, item.purchased],
    );
  }
  return { listId, path: `/dashboard/shopping-list/${listId}` };
}

async function seedTemplate(t: string, name: string, itemNames: string[]) {
  const id = `e2e-ux85-tpl-${t}`;
  await sql(`INSERT INTO "ShoppingListTemplate" (id, "householdId", name) VALUES ($1, $2, $3)`, [
    id,
    E2E_HOUSEHOLD.id,
    name,
  ]);
  for (const [i, itemName] of itemNames.entries()) {
    await sql(
      `INSERT INTO "ShoppingListTemplateItem" (id, "templateId", name, unit, position) VALUES ($1, $2, $3, 'pcs', $4)`,
      [`e2e-ux85-tpl-item-${t}-${i}`, id, itemName, i],
    );
  }
}

async function namesOnList(name: string) {
  const rows = await sql<{ name: string }>(
    `SELECT i.name FROM "ShoppingListItem" i JOIN "ShoppingList" l ON l.id = i."shoppingListId"
      WHERE l.name = $1 AND l."householdId" = $2 ORDER BY i.name`,
    [name, E2E_HOUSEHOLD.id],
  );
  return rows.map((row) => row.name);
}

async function openNewListSheet(page: Page) {
  await page.goto("/dashboard/shopping-list");
  await page.getByRole("button", { name: d.newList, exact: true }).click();
  return page.getByRole("dialog", { name: d.newListDialogTitle });
}

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test.afterAll(async () => {
  await sql(
    `DELETE FROM "ShoppingList" WHERE "householdId" = $1 AND (id LIKE 'e2e-ux85-%' OR name LIKE '%ux85-%')`,
    [E2E_HOUSEHOLD.id],
  );
  await sql(`DELETE FROM "ShoppingListTemplate" WHERE "householdId" = $1 AND id LIKE 'e2e-ux85-%'`, [
    E2E_HOUSEHOLD.id,
  ]);
});

test("a list is renamed from the ⋯ menu and from the pencil by its title", async ({ page }) => {
  const t = tag();
  const { path } = await seedList(t, `Old name ux85-${t}`, [{ name: `Pears ${t}`, purchased: false }]);
  await page.goto(path);

  await page.getByRole("button", { name: d.moreActions }).click();
  await page.getByRole("menuitem", { name: d.rename.menuItem }).click();
  const dialog = page.getByRole("dialog", { name: d.rename.dialogTitle });
  await dialog.getByLabel(d.rename.nameLabel).fill(`Menu name ux85-${t}`);
  await dialog.getByRole("button", { name: d.rename.save }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: `Menu name ux85-${t}` })).toBeVisible();

  // The pencil beside the title opens the same dialog, prefilled.
  await page.getByRole("button", { name: d.rename.titleAriaLabel }).click();
  await expect(dialog.getByLabel(d.rename.nameLabel)).toHaveValue(`Menu name ux85-${t}`);
  await dialog.getByLabel(d.rename.nameLabel).fill(`Pencil name ux85-${t}`);
  await dialog.getByRole("button", { name: d.rename.save }).click();
  await expect(dialog).toHaveCount(0);

  // It saved: still the new name after a reload.
  await page.reload();
  await expect(page.getByRole("heading", { name: `Pencil name ux85-${t}` })).toBeVisible();
});

test("a new list starts from a recent list's unbought items, or from all of them", async ({ page }) => {
  const t = tag();
  const source = `Last shop ux85-${t}`;
  await seedList(t, source, [
    { name: `Milk ${t}`, purchased: false },
    { name: `Bread ${t}`, purchased: true },
  ]);

  let sheet = await openNewListSheet(page);
  await sheet.getByLabel(d.nameLabel).fill(`Unbought copy ux85-${t}`);
  await sheet.getByRole("radio", { name: d.startFrom.recentList }).check();
  await sheet.getByRole("combobox", { name: d.startFrom.pickList }).click();
  await page.getByRole("option", { name: source }).click();
  // "Items not bought yet" is the default.
  await expect(sheet.getByRole("radio", { name: d.startFrom.scopeUnbought })).toBeChecked();
  await sheet.getByRole("button", { name: d.create }).click();
  await expect(page.getByRole("heading", { name: `Unbought copy ux85-${t}` })).toBeVisible();
  await expect(page.getByText(`Milk ${t}`).locator("visible=true").first()).toBeVisible();
  expect(await namesOnList(`Unbought copy ux85-${t}`)).toEqual([`Milk ${t}`]);

  sheet = await openNewListSheet(page);
  await sheet.getByLabel(d.nameLabel).fill(`Full copy ux85-${t}`);
  await sheet.getByRole("radio", { name: d.startFrom.recentList }).check();
  await sheet.getByRole("combobox", { name: d.startFrom.pickList }).click();
  await page.getByRole("option", { name: source }).click();
  await sheet.getByRole("radio", { name: d.startFrom.scopeAll }).check();
  await sheet.getByRole("button", { name: d.create }).click();
  await expect(page.getByRole("heading", { name: `Full copy ux85-${t}` })).toBeVisible();
  expect(await namesOnList(`Full copy ux85-${t}`)).toEqual([`Bread ${t}`, `Milk ${t}`]);
});

test("a new list starts from a template, and template rows say Use", async ({ page }) => {
  const t = tag();
  const name = `Taco night ux85-${t}`;
  await seedTemplate(t, name, [`Tortillas ${t}`, `Salsa ${t}`]);

  // One "New list" button on the page; the template row's button is "Use".
  await page.goto("/dashboard/shopping-list");
  await expect(page.getByRole("button", { name: d.newList, exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: `Use template "${name}"` })).toHaveText(d.templates.use);

  const sheet = await openNewListSheet(page);
  await sheet.getByRole("radio", { name: d.startFrom.template }).check();
  await sheet.getByRole("combobox", { name: d.startFrom.pickTemplate }).click();
  await page.getByRole("option", { name }).click();
  await sheet.getByRole("button", { name: d.create }).click();

  // Left blank, the name is the template's.
  await expect(page.getByRole("heading", { name })).toBeVisible();
  expect(await namesOnList(name)).toEqual([`Salsa ${t}`, `Tortillas ${t}`]);
});
