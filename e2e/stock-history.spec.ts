import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD, E2E_USER, E2E_USER_SV, STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow, LOCALES } from "./ui";

// GAP-66: the item page's collapsed "History" says who changed the amount.
// A uniquely named item is written straight to Postgres (like
// item-page-controls.spec.ts), decremented through the stepper, and the
// event shows up under History after a reload, with the actor's name.
const PREFIX = "e2e-stock-history-";

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

// Only this household's rows; the item's events go with it (ON DELETE CASCADE).
test.afterEach(async () => {
  await withClient((client) =>
    client.query(`DELETE FROM "InventoryItem" WHERE "householdId" = $1 AND id LIKE $2`, [E2E_HOUSEHOLD.id, `${PREFIX}%`]),
  );
});

for (const locale of LOCALES) {
  test.describe(`stock history (${locale})`, () => {
    test.use({ storageState: locale === "sv" ? STORAGE_STATE_SV : STORAGE_STATE });

    test.beforeEach(async ({ context, baseURL }) => {
      await dismissCookieNotice(context, baseURL!);
    });

    test("a decrement shows under History with who made it, after a reload", async ({ page }) => {
      const tag = `${Date.now().toString(36)}-w${E2E_WORKER}-${locale}`;
      const item = { id: `${PREFIX}${tag}`, name: `Rice ${tag}` };
      await withClient((client) =>
        client.query(
          `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "lowStockThreshold", "updatedAt")
           VALUES ($1, $2, $3, 'Pantry', 3, 'pcs', 0.5, now())`,
          [item.id, E2E_HOUSEHOLD.id, item.name],
        ),
      );
      const strings =
        locale === "sv"
          ? { decrease: "Minska", history: "Historik", line: `${E2E_USER_SV.displayName} använde 1 st` }
          : { decrease: "Decrease", history: "History", line: `${E2E_USER.displayName} used 1 pcs` };

      await page.goto(`/dashboard/inventory/items/${item.id}`);
      const main = page.getByRole("main");
      // Nothing to show before the first change.
      await expect(main.getByText(strings.history, { exact: true })).toHaveCount(0);

      const decrease = main.getByRole("button", { name: `${strings.decrease} ${item.name}` });
      await expectHydrated(decrease);
      await decrease.click();
      await expect(main.getByRole("button", { name: new RegExp(`${item.name} \\(2 `) })).toBeVisible();

      // The stepper updates optimistically, so the reload must wait until the
      // action has really written (else it races the server action).
      await expect
        .poll(() =>
          withClient(async (client) => {
            const { rows } = await client.query(`SELECT count(*)::int AS n FROM "InventoryItemEvent" WHERE "itemId" = $1`, [item.id]);
            return rows[0].n as number;
          }),
        )
        .toBe(1);

      await page.reload();
      const summary = main.getByText(strings.history, { exact: true });
      await expect(summary).toBeVisible();
      // Collapsed until opened.
      const row = main.getByText(strings.line);
      await expect(row).toBeHidden();
      await summary.click();
      await expect(row).toBeVisible();
      await expect(row).toContainText("·");
      await expectNoHorizontalOverflow(page);
    });
  });
}
