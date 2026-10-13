import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { dismissCookieNotice } from "./ui";

// GAP-44: "Freeze" on an expiring inventory item moves its best-before date
// ~90 days out, tags it "Frozen", takes it out of "Expiring soon" and offers
// the same Undo toast as "Mark opened". The item is written straight to
// Postgres (like item-page.spec.ts) with a date two days away.
const suffix = () => `t${Math.random().toString(36).slice(2, 10)}`;
const DAY_MS = 24 * 60 * 60 * 1000;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

// The worker's household is shared with every spec it runs, and a leftover
// frozen item makes a phone card's badges crowd the next spec's layout
// checks, so remove what these tests created (only this household's rows).
test.afterEach(async () => {
  await withClient((client) =>
    client.query(`DELETE FROM "InventoryItem" WHERE "householdId" = $1 AND id LIKE 'e2e-freeze-%'`, [E2E_HOUSEHOLD.id]),
  );
});

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function seedExpiringItem(name: string, id: string) {
  await withClient((client) =>
    client.query(
      `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "expiresAt", "updatedAt")
       VALUES ($1, $2, $3, 'Meat & fish', 2, 'pcs', now() + interval '2 days', now())`,
      [id, E2E_HOUSEHOLD.id, name],
    ),
  );
}

const storedExpiry = (id: string) =>
  withClient(async (client) => {
    const { rows } = await client.query(`SELECT "expiresAt", "frozenAt" FROM "InventoryItem" WHERE id = $1`, [id]);
    return rows[0] as { expiresAt: Date; frozenAt: Date | null };
  });

// Right after navigation the streamed page can briefly hold two copies of
// the list, so wait for the single visible search field before typing.
async function searchInventory(page: Page, query: string) {
  await page.goto("/dashboard/inventory");
  const search = page.getByPlaceholder("Search by name…").filter({ visible: true });
  await expect(search).toHaveCount(1);
  await search.fill(query);
}

async function clickFreeze(page: Page, name: string) {
  if (test.info().project.name === "mobile") {
    await page.getByRole("button", { name: "More actions", exact: true }).filter({ visible: true }).click();
    await page.getByRole("menuitem", { name: "Freeze", exact: true }).click();
  } else {
    await page.getByRole("button", { name: `Freeze ${name}`, exact: true }).filter({ visible: true }).click();
  }
}

test("freezing an expiring item tags it Frozen, pushes the date out and survives a reload", async ({ page }) => {
  const tag = suffix();
  const name = `Mince ${tag}`;
  const id = `e2e-freeze-${tag}`;
  await seedExpiringItem(name, id);

  await searchInventory(page, name);
  await expect(page.getByText("Expiring soon").filter({ visible: true })).toBeVisible();
  await clickFreeze(page, name);
  await expect(page.getByText(`${name} frozen`)).toBeVisible();
  await expect(page.getByText("Frozen", { exact: true }).filter({ visible: true })).toBeVisible();

  await page.reload();
  await searchInventory(page, name);
  await expect(page.getByText("Frozen", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText("Expiring soon")).toHaveCount(0);

  const stored = await storedExpiry(id);
  expect(stored.frozenAt).not.toBeNull();
  expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now() + 85 * DAY_MS);
});

test("Undo on the freeze toast puts the original date back", async ({ page }) => {
  const tag = suffix();
  const name = `Bread ${tag}`;
  const id = `e2e-freeze-${tag}`;
  await seedExpiringItem(name, id);

  await searchInventory(page, name);
  await clickFreeze(page, name);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText(`${name} is back to unfrozen`)).toBeVisible();

  const stored = await storedExpiry(id);
  expect(stored.frozenAt).toBeNull();
  expect(stored.expiresAt.getTime()).toBeLessThan(Date.now() + 3 * DAY_MS);
});
