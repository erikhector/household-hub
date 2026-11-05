import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD, STORAGE_STATE_SV } from "./seed";
import { E2E_SHOPPING_LIST, E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, gotoRevealed } from "./ui";

// UX-41c: single-key shortcuts on the list pages and the `?` overlay. A
// desktop-only feature (a keyboard and a fine pointer), so this spec is
// desktop-only; the mobile project has no keys to press.
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

// The key listener attaches on hydration, which a press right after goto can
// beat. Press again until the effect shows, so a slow hydration only delays.
async function pressUntil(page: Page, key: string, effect: () => Promise<void>) {
  await expect(async () => {
    await page.keyboard.press(key);
    await effect();
  }).toPass();
}

test("? opens the shortcuts overlay and Escape closes it", async ({ page }) => {
  await gotoRevealed(page, "/dashboard/tasks");
  const overlay = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await pressUntil(page, "Shift+?", async () => {
    await expect(overlay).toBeVisible({ timeout: 1000 });
  });
  await expect(overlay.getByText("Next row")).toBeVisible();
  await expect(overlay.getByText("Search")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(overlay).toHaveCount(0);
});

test("n opens Add task, and keys are ignored in the dialog's own fields", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await gotoRevealed(page, "/dashboard/tasks");
  const dialog = page.getByRole("dialog", { name: /task/i });
  await pressUntil(page, "n", async () => {
    await expect(dialog).toBeVisible({ timeout: 1000 });
  });
  const title = dialog.getByRole("textbox", { name: "Task title" });
  await title.fill("jnx kx");
  await expect(title).toHaveValue("jnx kx");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("j and k move through the task rows and x ticks the highlighted one", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  const first = unique("Shortcut first");
  const second = unique("Shortcut second");
  await gotoRevealed(page, "/dashboard/tasks");
  for (const title of [first, second]) {
    await page.getByRole("button", { name: "Add task" }).click();
    await page.getByRole("textbox", { name: "Task title" }).fill(title);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: `Mark ${title} as done` })).toBeVisible();
  }

  const active = page.locator("[data-shortcut-active]");
  await pressUntil(page, "j", async () => {
    await expect(active).toHaveCount(1, { timeout: 1000 });
  });
  const firstRowLabel = await active.getByRole("checkbox").getAttribute("aria-label");
  expect(firstRowLabel).toMatch(/^Mark .+ as done$/);

  await page.keyboard.press("j");
  await expect(active).toHaveCount(1);
  const secondRowLabel = await active.getByRole("checkbox").getAttribute("aria-label");
  expect(secondRowLabel).not.toBe(firstRowLabel);

  await page.keyboard.press("k");
  await expect(active.getByRole("checkbox")).toHaveAttribute("aria-label", firstRowLabel!);

  await page.keyboard.press("x");
  const ticked = firstRowLabel!.replace(/^Mark (.+) as done$/, "$1");
  await expect(page.getByRole("checkbox", { name: `Mark ${ticked} as not done` })).toBeChecked();
});

test("/ focuses the inventory search and the keys type into it instead of moving rows", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await gotoRevealed(page, "/dashboard/inventory");
  const search = page.getByRole("searchbox");
  await pressUntil(page, "/", async () => {
    await expect(search).toBeFocused({ timeout: 1000 });
  });
  // The slash was swallowed, and j / k / x are text while a field has focus.
  await expect(search).toHaveValue("");
  await page.keyboard.type("jkx");
  await expect(search).toHaveValue("jkx");
  await expect(page.locator("[data-shortcut-active]")).toHaveCount(0);
});

test("n focuses the shopping list's add field", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await gotoRevealed(page, `/dashboard/shopping-list/${E2E_SHOPPING_LIST.id}`);
  const add = page.getByRole("combobox", { name: /add/i }).first();
  await pressUntil(page, "n", async () => {
    await expect(add).toBeFocused({ timeout: 1000 });
  });
  await expect(add).toHaveValue("");
});

test("the keys do nothing on other pages", async ({ page }) => {
  await gotoRevealed(page, "/dashboard/budget");
  await page.waitForTimeout(500);
  await page.keyboard.press("Shift+?");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("x ticks the highlighted shopping row into \"In the cart\"", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  const tag = `${Date.now().toString(36)}-w${E2E_WORKER}`;
  const listId = `e2e-ux41c-list-${tag}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, $3)`, [
      listId,
      E2E_HOUSEHOLD.id,
      `Keys ${tag}`,
    ]);
    // Two rows, so ticking one leaves the list in its normal (not "all cleared") state.
    for (const i of [0, 1]) {
      await client.query(`INSERT INTO "ShoppingListItem" (id, "shoppingListId", name) VALUES ($1, $2, $3)`, [
        `e2e-ux41c-item-${tag}-${i}`,
        listId,
        `Key item ${i} ${tag}`,
      ]);
    }
    await gotoRevealed(page, `/dashboard/shopping-list/${listId}`);
    const active = page.locator("[data-shortcut-active]");
    await pressUntil(page, "j", async () => {
      await expect(active).toHaveCount(1, { timeout: 1000 });
    });
    await page.keyboard.press("x");
    await expect(page.getByRole("button", { name: /^In the cart/ })).toContainText("1");
  } finally {
    await client.query(`DELETE FROM "ShoppingList" WHERE id = $1 AND "householdId" = $2`, [listId, E2E_HOUSEHOLD.id]);
    await client.end();
  }
});

test("x toggles the highlighted inventory row's bulk-select checkbox", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await gotoRevealed(page, "/dashboard/inventory");
  const active = page.locator("[data-shortcut-active]");
  await pressUntil(page, "j", async () => {
    await expect(active).toHaveCount(1, { timeout: 1000 });
  });
  const box = active.getByRole("checkbox");
  await expect(box).not.toBeChecked();
  await page.keyboard.press("x");
  await expect(box).toBeChecked();
  await page.keyboard.press("x");
  await expect(box).not.toBeChecked();
});

test.describe("sv", () => {
  test.use({ storageState: STORAGE_STATE_SV });

  test("/ still focuses the search when the layout needs Shift for it", async ({ page, context, baseURL }) => {
    await dismissCookieNotice(context, baseURL!);
    await gotoRevealed(page, "/dashboard/inventory");
    const search = page.getByRole("searchbox");
    // A Swedish keyboard types "/" as Shift+7, so the event is key "/" with
    // shiftKey set. Playwright's own press("Shift+/") would yield "?" on a US
    // layout, so dispatch the event the Swedish layout produces.
    await expect(async () => {
      await page.evaluate(() =>
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "/", shiftKey: true, bubbles: true, cancelable: true })),
      );
      await expect(search).toBeFocused({ timeout: 1000 });
    }).toPass();
  });
});
