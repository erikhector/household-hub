import { expect, test, type Page } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { dismissCookieNotice, expectHydrated } from "./ui";

// UX-36: the shopping list survives a dead zone. A tick made offline joins a
// queue with a "N changes waiting" chip, and is saved when the connection is
// back. The tests make their own list, so they neither depend on nor change
// the seeded one.
//
// Names end in a letter: the smart add line reads a trailing "x<digits>" as a
// quantity (see copy-shopping-list-text.spec.ts).
const unique = (label: string) => `${label} ${Date.now().toString(36)}z`;

const t = en.shoppingList;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

async function openListWith(page: Page, listName: string, items: string[]) {
  await page.goto("/dashboard/shopping-list");
  await page.getByRole("button", { name: "New list" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(listName);
  await page.getByRole("button", { name: "Create list" }).click();
  await expect(page.getByRole("heading", { level: 1, name: listName })).toBeVisible();

  const addBox = page.getByRole("combobox", { name: "Add to the list" });
  await addBox.fill(items.join(", "));
  await addBox.press("Enter");
  for (const name of items) {
    await expect(page.getByRole("checkbox", { name: new RegExp(`^${name}\\b`, "i") })).toBeVisible();
  }
}

test("a tick made offline waits in a queue and is saved when the connection is back", async ({ page, context }) => {
  const listName = unique("Offline shop");
  const oat = unique("Oat drink");
  const rye = unique("Rye bread");
  // A third item stays open, so the list never reaches its all-done state.
  await openListWith(page, listName, [oat, rye, unique("Cheese")]);

  const oatBox = page.getByRole("checkbox", { name: new RegExp(`^${oat}\\b`, "i") });
  await expectHydrated(oatBox);

  await context.setOffline(true);
  await oatBox.click();

  // The row moves at once and the chip says it hasn't been saved.
  await expect(page.getByRole("status").filter({ hasText: "1 change waiting to sync" })).toBeVisible();
  const cart = page.getByRole("button", { name: /^In the cart/ });
  await expect(cart).toContainText("1");
  await cart.click();
  await expect(oatBox).toBeChecked();

  // A second tick joins the first; the chip counts both.
  await page.getByRole("checkbox", { name: new RegExp(`^${rye}\\b`, "i") }).click();
  await expect(page.getByRole("status").filter({ hasText: "2 changes waiting to sync" })).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByRole("status").filter({ hasText: "waiting to sync" })).toHaveCount(0);

  // Saved on the server, not only shown: both are still ticked after a reload.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: listName })).toBeVisible();
  await expect(cart).toContainText("2");
  await cart.click();
  await expect(page.getByRole("checkbox", { name: new RegExp(`^${oat}\\b`, "i") })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: new RegExp(`^${rye}\\b`, "i") })).toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: "waiting to sync" })).toHaveCount(0);
});

test("the list you last opened still opens with no connection", async ({ page, context }) => {
  const listName = unique("Cached shop");
  const oat = unique("Oat drink");
  await openListWith(page, listName, [oat]);
  const url = page.url();

  // The worker only sees navigations once it controls the page, so wait for
  // that and load the list again: that visit is the one it keeps a copy of.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1, name: listName })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const cache = await caches.open("squirrel-shopping-list-v1");
        return (await cache.keys()).length;
      }),
    )
    .toBeGreaterThan(0);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: listName })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: new RegExp(`^${oat}\\b`, "i") })).toBeVisible();
  // Not the "You're offline" page.
  await expect(page.getByText(t.backToAll)).toBeVisible();
});
