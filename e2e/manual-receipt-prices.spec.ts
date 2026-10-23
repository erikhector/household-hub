import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice } from "./ui";

// UX-140: when the receipt photo can't be read, the dialog offers "Enter
// prices by hand" next to "Try another photo", and Register receipt gets an
// "Add line". The vision call is mocked to fail (a provider error), so the
// only way forward is typing. Rows are written straight to Postgres and named
// uniquely: the desktop and mobile runs share the worker's household.
const tag = () => `${Date.now().toString(36)}-w${E2E_WORKER}`;

// A valid 1x1 PNG: fileToResizedDataUrl needs a decodable image to get as
// far as the scan action.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function sql(text: string, values: unknown[] = []) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(text, values)).rows;
  } finally {
    await client.end();
  }
}

/** Every receipt-scan call comes back as the provider being busy, the way a
 * real failure does (a Server Action answer carrying an error code). */
async function failTheScan(page: Page) {
  await page.route(
    (url) => url.pathname.startsWith("/dashboard/shopping-list"),
    async (route) => {
      const request = route.request();
      if (request.method() === "POST" && (request.postData() ?? "").includes("data:image")) {
        await route.fulfill({
          status: 200,
          contentType: "text/x-component",
          body: '0:{"a":"$@1","f":"","b":"e2e"}\n1:{"error":"provider_busy"}\n',
        });
        return;
      }
      await route.continue();
    },
  );
}

async function pickPhoto(page: Page) {
  await page
    .locator('input[type="file"]:not([capture])')
    .first()
    .setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: PNG });
}

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test.afterAll(async () => {
  await sql(`DELETE FROM "ShoppingList" WHERE id LIKE 'e2e-ux140-%' AND "householdId" = $1`, [E2E_HOUSEHOLD.id]);
  await sql(`DELETE FROM "ShoppingList" WHERE name LIKE 'E2E typed receipt %' AND "householdId" = $1`, [
    E2E_HOUSEHOLD.id,
  ]);
  await sql(`DELETE FROM "InventoryItem" WHERE id LIKE 'e2e-ux140-%' AND "householdId" = $1`, [E2E_HOUSEHOLD.id]);
});

test("a failed scan lets you type the price, and it's recorded like a scanned one", async ({ page }) => {
  const t = tag();
  const name = `Typed milk ${t}`;
  const listId = `e2e-ux140-list-${t}`;
  const invId = `e2e-ux140-inv-${t}`;
  await sql(
    `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "updatedAt")
     VALUES ($1, $2, $3, 'Dairy', 0, 'pcs', now())`,
    [invId, E2E_HOUSEHOLD.id, name],
  );
  await sql(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, $3)`, [
    listId,
    E2E_HOUSEHOLD.id,
    `Typed ${t}`,
  ]);
  await sql(
    `INSERT INTO "ShoppingListItem" (id, "shoppingListId", "inventoryItemId", name, quantity, unit)
     VALUES ($1, $2, $3, $4, 3, 'pcs')`,
    [`e2e-ux140-item-${t}`, listId, invId, name],
  );

  await page.goto(`/dashboard/shopping-list/${listId}`);
  await failTheScan(page);
  await page.getByRole("button", { name: "Register receipt" }).click();
  await page.getByRole("menuitem", { name: "Choose photo" }).click();
  await pickPhoto(page);

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Try another photo" })).toBeVisible();
  await dialog.getByRole("button", { name: "Enter prices by hand" }).click();

  // The review step: one row for the list item, its price empty.
  await expect(dialog.getByText(name)).toBeVisible();
  const price = dialog.getByRole("spinbutton", { name: "Price" });
  await expect(price).toHaveValue("");
  await price.fill("45");
  await dialog.getByRole("button", { name: "Apply to list" }).click();
  // Put-away mode follows a receipt that only priced the rows: leave the
  // stock for later, the price is already recorded.
  await expect(page.getByRole("heading", { name: "Put away your shopping" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

  // 45 paid for 3, stored like a scanned line: lastKnownPrice is the line's
  // price, the same number as its estimatedPrice (recipe-cost.ts finds the
  // line by that match and divides by its quantity), and PriceHistory keeps
  // the price with the quantity it bought.
  await page.reload();
  await expect(page.getByRole("main").getByText("≈ 45.00").first()).toBeVisible();
  const [item] = await sql(`SELECT "lastKnownPrice" FROM "InventoryItem" WHERE id = $1`, [invId]);
  expect(item.lastKnownPrice).toBe(45);
  const [row] = await sql(`SELECT "estimatedPrice", purchased, "priceRecordedAt" FROM "ShoppingListItem" WHERE id = $1`, [
    `e2e-ux140-item-${t}`,
  ]);
  expect(row.estimatedPrice).toBe(45);
  expect(row.purchased).toBe(true);
  expect(row.priceRecordedAt).not.toBeNull();
  const history = await sql(`SELECT price, quantity FROM "PriceHistory" WHERE "inventoryItemId" = $1`, [invId]);
  expect(history).toEqual([{ price: 45, quantity: 3 }]);
});

test("Register receipt can be typed in line by line when the scan fails", async ({ page }) => {
  const t = tag();
  const name = `E2E typed receipt ${t}`;
  await page.goto("/dashboard/shopping-list");
  await failTheScan(page);
  await page.getByRole("button", { name: "Register receipt" }).click();
  await page.getByRole("menuitem", { name: "Choose photo" }).click();
  await pickPhoto(page);

  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Enter receipt by hand" }).click();

  await expect(dialog.getByText(/Type each item with what you paid/)).toBeVisible();
  await dialog.locator("#register-receipt-name").fill(name);
  await dialog.getByRole("button", { name: "Add line" }).click();
  await expect(dialog.getByRole("spinbutton", { name: "Price" })).toHaveCount(2);
  // The new line's name field takes focus, so on a phone it scrolls into
  // view and the tap visibly did something.
  await expect(dialog.locator('input[name="name"]').nth(1)).toBeFocused();

  // Two lines: both created as new items (no inventory match to pick).
  for (const [i, [line, amount]] of [
    [`Typed bread ${t}`, "30"],
    [`Typed jam ${t}`, "12.5"],
  ].entries()) {
    await dialog.getByRole("spinbutton", { name: "Price" }).nth(i).fill(amount);
    await dialog.getByRole("button", { name: "Create new" }).nth(i).click();
    // Last, and left with Tab: an open suggestion list hides the rest.
    await dialog.locator('input[name="name"]').nth(i).fill(line);
    await page.keyboard.press("Tab");
  }
  await dialog.getByRole("button", { name: "Register receipt" }).click();

  await expect(page).toHaveURL(/\/dashboard\/shopping-list\/[^/]+$/);
  await page.reload();
  await expect(page.getByText(`Typed bread ${t}`).first()).toBeVisible();
  await expect(page.getByText(`Typed jam ${t}`).first()).toBeVisible();
});
