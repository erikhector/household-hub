import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice } from "./ui";

// UX-119: "I used some" and "I bought more" for weights and volumes. The
// stepper moves by a step that suits the unit, and tapping the quantity opens
// a sheet whose chips apply an amount in one tap. Items are written straight
// to Postgres under a per-run suffix so searching for it shows only these.
const suffix = `${E2E_WORKER}${Math.random().toString(36).slice(2, 7)}`;
const idPrefix = `e2e-ux119-${E2E_WORKER}-`;
const butter = `Butter ${suffix}`;
const onion = `Onion ${suffix}`;
const milk = `Milk ${suffix}`;
const flour = `Flour ${suffix}`;
const rice = `Rice ${suffix}`;

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

test.beforeAll(async () => {
  await withClient(async (client) => {
    const rows: [string, string, number, string][] = [
      ["butter", butter, 500, "g"],
      ["onion", onion, 1.5, "kg"],
      ["milk", milk, 2, "l"],
      ["flour", flour, 500, "g"],
      ["rice", rice, 1.5, "kg"],
    ];
    for (const [key, name, quantity, unit] of rows) {
      await client.query(
        `INSERT INTO "InventoryItem" (id, "householdId", name, category, location, quantity, unit, "updatedAt")
         VALUES ($1, $2, $3, 'Pantry', 'Cupboard', $4, $5, now())`,
        [`${idPrefix}${key}`, E2E_HOUSEHOLD.id, name, quantity, unit],
      );
    }
  });
});

test.afterAll(async () => {
  await withClient((client) =>
    client.query(`DELETE FROM "InventoryItem" WHERE "householdId" = $1 AND id LIKE $2`, [E2E_HOUSEHOLD.id, `${idPrefix}%`]),
  );
});

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

async function showItems(page: Page) {
  await page.goto("/dashboard/inventory");
  const search = page.getByRole("searchbox").filter({ visible: true });
  await expect(search).toHaveCount(1);
  await search.fill(suffix);
}

// The visible quantity button of one item (the table on desktop, the card on a phone).
function quantityButton(page: Page, name: string) {
  return page.getByRole("button", { name: new RegExp(`^Adjust ${name} `) }).filter({ visible: true });
}

async function waitForSave(page: Page, act: () => Promise<void>) {
  const saved = page.waitForResponse(
    (response) => response.request().method() === "POST" && "next-action" in response.request().headers(),
  );
  await act();
  await saved;
}

test("the stepper moves a gram item by 50 and a kilo item by a quarter", async ({ page }) => {
  await showItems(page);
  await waitForSave(page, () =>
    page.getByRole("button", { name: `Decrease ${butter}`, exact: true }).filter({ visible: true }).click(),
  );
  await expect(quantityButton(page, butter)).toHaveText("450 g");

  await waitForSave(page, () =>
    page.getByRole("button", { name: `Decrease ${onion}`, exact: true }).filter({ visible: true }).click(),
  );
  await expect(quantityButton(page, onion)).toHaveText("1.25 kg");

  await showItems(page);
  await expect(quantityButton(page, butter)).toHaveText("450 g");
  await expect(quantityButton(page, onion)).toHaveText("1.25 kg");
});

test("a gram item drops by 200 g in two taps, and a bought amount adds", async ({ page }) => {
  await showItems(page);
  await quantityButton(page, flour).click();
  const sheet = page.getByRole("dialog", { name: flour });
  await expect(sheet).toBeVisible();
  // For the UX scout's screenshot run (see AGENTS.md, "Screenshots").
  if (process.env.E2E_SCREENSHOT_DIR) {
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${test.info().project.name}-inventory-quantity-sheet.png` });
  }
  // Tap 2: the chip applies and closes the sheet.
  await waitForSave(page, () => sheet.getByRole("button", { name: "200 g", exact: true }).click());
  await expect(sheet).toBeHidden();
  await expect(quantityButton(page, flour)).toHaveText("300 g");

  // Bought, with a typed decimal comma amount, on the litre item.
  await quantityButton(page, milk).click();
  const milkSheet = page.getByRole("dialog", { name: milk });
  await milkSheet.getByRole("button", { name: "Bought", exact: true }).click();
  await milkSheet.getByRole("textbox", { name: /^Amount/ }).fill("0,5");
  await waitForSave(page, () => milkSheet.getByRole("button", { name: "Add amount" }).click());
  await expect(quantityButton(page, milk)).toHaveText("2.5 l");

  await showItems(page);
  await expect(quantityButton(page, flour)).toHaveText("300 g");
  await expect(quantityButton(page, milk)).toHaveText("2.5 l");
});

test("All empties the item and Last repeats the previous amount", async ({ page }) => {
  await showItems(page);
  await quantityButton(page, rice).click();
  const sheet = page.getByRole("dialog", { name: rice });
  await waitForSave(page, () => sheet.getByRole("button", { name: "0.5 kg", exact: true }).click());
  await expect(quantityButton(page, rice)).toHaveText("1 kg");

  await quantityButton(page, rice).click();
  const again = page.getByRole("dialog", { name: rice });
  await waitForSave(page, () => again.getByRole("button", { name: "Last 0.5 kg", exact: true }).click());
  await expect(quantityButton(page, rice)).toHaveText("0.5 kg");

  await quantityButton(page, rice).click();
  const last = page.getByRole("dialog", { name: rice });
  await waitForSave(page, () => last.getByRole("button", { name: "All", exact: true }).click());
  await expect(quantityButton(page, rice)).toHaveText("0 kg");
});
