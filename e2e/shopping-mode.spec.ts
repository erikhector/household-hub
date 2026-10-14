import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { collectErrors, dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-37: shopping mode as a tool. A whole shop can be ticked off with the
// thumb from the "Next up" dock (sticky in the bottom half of the screen)
// without scrolling to the top; ticked rows collapse into "In the cart";
// the whole row is the tap target; and the "All done" moment offers to put
// things away. Lists are written straight to Postgres, named uniquely, and
// removed again afterwards (only this worker's household's rows).
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

type SeedItem = { name: string; category?: string; note?: string; purchased?: boolean };

// Each item is linked to its own InventoryItem (that's where its aisle, the
// category, lives). `purchased` rows are ticked but not put away yet.
async function seedList(t: string, items: SeedItem[]) {
  const listId = `e2e-ux37-list-${t}`;
  await sql(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, $3)`, [
    listId,
    E2E_HOUSEHOLD.id,
    `Shop ${t}`,
  ]);
  for (const [i, item] of items.entries()) {
    const inventoryId = `e2e-ux37-inv-${t}-${i}`;
    await sql(
      `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "updatedAt")
       VALUES ($1, $2, $3, $4, 0, 'pcs', now())`,
      [inventoryId, E2E_HOUSEHOLD.id, item.name, item.category ?? "Uncategorized"],
    );
    await sql(
      `INSERT INTO "ShoppingListItem" (id, "shoppingListId", name, unit, note, purchased, "inventoryItemId")
       VALUES ($1, $2, $3, 'pcs', $4, $5, $6)`,
      [`e2e-ux37-item-${t}-${i}`, listId, item.name, item.note ?? null, item.purchased ?? false, inventoryId],
    );
  }
  return `/dashboard/shopping-list/${listId}`;
}

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test.afterAll(async () => {
  for (const table of ["ShoppingList", "InventoryItem"]) {
    await sql(`DELETE FROM "${table}" WHERE id LIKE 'e2e-ux37-%' AND "householdId" = $1`, [E2E_HOUSEHOLD.id]);
  }
});

// Phones only: from sm the dock is sticky at the bottom of a sidebar
// layout's column, and nobody shops one-handed on that.
async function expectInBottomHalf(page: Page, locator: ReturnType<Page["locator"]>) {
  if (page.viewportSize()!.width >= 640) return;
  const box = (await locator.boundingBox())!;
  const height = page.viewportSize()!.height;
  expect(box.y + box.height / 2, "in the thumb zone").toBeGreaterThan(height / 2);
  expect(box.y + box.height, "on screen").toBeLessThanOrEqual(height);
}

test("a whole shop is ticked off from the dock in the thumb zone, without scrolling up", async ({ page }) => {
  const errors = collectErrors(page);
  const t = tag();
  const names = [`Apples ${t}`, `Pears ${t}`, `Cheese ${t}`, `Yoghurt ${t}`];
  const path = await seedList(t, [
    { name: names[0], category: `Aisle A ${t}` },
    { name: names[1], category: `Aisle A ${t}` },
    { name: names[2], category: `Aisle B ${t}` },
    { name: names[3], category: `Aisle B ${t}` },
  ]);
  await page.goto(path);

  const dock = page.getByRole("region", { name: "Next up" });
  const progress = dock.getByRole("progressbar", { name: "Shopping progress" });
  await expect(progress).toHaveAttribute("aria-valuetext", "0 of 4");
  await expect(dock).toContainText("0 of 4");
  await expectNoHorizontalOverflow(page);

  for (let done = 1; done <= names.length; done++) {
    const next = dock.getByRole("button", { name: /, into the cart$/ }).first();
    await expectInBottomHalf(page, next);
    await next.click();
    if (done < names.length) await expect(progress).toHaveAttribute("aria-valuetext", `${done} of 4`);
  }

  // The "All done" moment, with the ring full and the next step offered.
  await expect(page.getByText("All done", { exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Shopping progress" })).toHaveAttribute("aria-valuetext", "4 of 4");
  await expect(dock).toHaveCount(0);
  const doneShopping = page.getByRole("button", { name: "Done shopping" });
  await expect(doneShopping).toBeEnabled();

  // Never scrolled: neither the page nor (on a phone) main, its scroller.
  const scrolled = await page.evaluate(() => window.scrollY + (document.querySelector("main")?.scrollTop ?? 0));
  expect(scrolled).toBe(0);

  // Every tick saved.
  await page.reload();
  await expect(page.getByRole("button", { name: "Done shopping" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("ticked rows collapse into In the cart, and the whole row is the target", async ({ page }) => {
  const t = tag();
  const note = `the green ones ${t}`;
  const name = `Grapes ${t}`;
  const path = await seedList(t, [{ name, note }, { name: `Lemons ${t}` }]);
  await page.goto(path);

  const box = page.getByRole("checkbox", { name: new RegExp(`^${name} ×`) });
  const cart = page.getByRole("button", { name: /^In the cart/ });
  await expect(cart).toHaveCount(0);

  // Tapping the note — not the checkbox or the name — ticks the row.
  // A real tap at the note's centre: what's hit there is the label's
  // row-wide hit area, not the note.
  const noteBox = (await page.getByText(note).boundingBox())!;
  await page.mouse.click(noteBox.x + noteBox.width / 2, noteBox.y + noteBox.height / 2);
  await expect(box).toBeChecked();
  await expect(cart).toHaveAttribute("aria-expanded", "false");
  await expect(cart).toContainText("1");
  await expect(box).toBeHidden();

  // Opening the section shows it, and un-ticking there puts it back.
  await cart.click();
  await expect(cart).toHaveAttribute("aria-expanded", "true");
  await expect(box).toBeVisible();
  await box.click();
  await expect(box).not.toBeChecked();
  await expect(cart).toHaveCount(0);
  await expect(box).toBeVisible();

  await page.reload();
  await expect(box).not.toBeChecked();
});

test("All done offers to put away what's still in the cart", async ({ page }) => {
  const t = tag();
  const path = await seedList(t, [
    { name: `Rice ${t}`, purchased: true },
    { name: `Beans ${t}` },
  ]);
  await page.goto(path);

  await page.getByRole("region", { name: "Next up" }).getByRole("button", { name: /^Beans .*, into the cart$/ }).click();
  await expect(page.getByText("All done", { exact: true })).toBeVisible();
  // At least the seeded row waits (Beans too, if the household puts away later).
  await expect(page.getByText(/things? (is|are) waiting to be put away\.$/)).toBeVisible();
  await page.getByRole("button", { name: "Put things away" }).click();
  await expect(page.getByRole("dialog", { name: "Put away before you finish?" })).toBeVisible();
});
