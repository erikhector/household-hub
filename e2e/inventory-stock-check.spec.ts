import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD, STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow, gotoRevealed, LOCALES } from "./ui";

// GAP-69: "Check stock" walks one location, one item per step. A changed
// amount is saved as a counted value, "Correct, next" on an untouched one
// saves nothing, and the end summary counts both. Each run makes its own
// location so the walk holds only its two items, whatever else the worker's
// household has collected.
const copy = {
  en: { trigger: "Check stock", next: "Correct, next", summary: "2 checked, 1 corrected", done: "Done" },
  sv: { trigger: "Kontrollera lager", next: "Stämmer, nästa", summary: "2 kontrollerade, 1 rättade", done: "Klar" },
} as const;

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

for (const locale of LOCALES) {
  test.describe(`stock check (${locale})`, () => {
    test.use({ storageState: locale === "sv" ? STORAGE_STATE_SV : STORAGE_STATE });
    const c = copy[locale];
    const suffix = `${E2E_WORKER}${Math.random().toString(36).slice(2, 7)}`;
    const idPrefix = `e2e-gap69-${locale}-${E2E_WORKER}-`;
    const location = `Check shelf ${suffix}`;
    const alpha = `Alpha lentils ${suffix}`;
    const beta = `Beta rice ${suffix}`;

    test.beforeEach(async ({ context, baseURL }) => {
      await dismissCookieNotice(context, baseURL!);
      await withClient(async (client) => {
        await client.query(`DELETE FROM "InventoryItem" WHERE "householdId" = $1 AND id LIKE $2`, [E2E_HOUSEHOLD.id, `${idPrefix}%`]);
        for (const [key, name, quantity, unit] of [
          ["alpha", alpha, 4, "pcs"],
          ["beta", beta, 2, "kg"],
        ] as const) {
          await client.query(
            `INSERT INTO "InventoryItem" (id, "householdId", name, category, location, quantity, unit, "updatedAt")
             VALUES ($1, $2, $3, 'Pantry', $4, $5, $6, now())`,
            [`${idPrefix}${key}`, E2E_HOUSEHOLD.id, name, location, quantity, unit],
          );
        }
      });
    });

    test.afterEach(async () => {
      await withClient((client) =>
        client.query(`DELETE FROM "InventoryItem" WHERE "householdId" = $1 AND id LIKE $2`, [E2E_HOUSEHOLD.id, `${idPrefix}%`]),
      );
    });

    async function openCheck(page: import("@playwright/test").Page) {
      await gotoRevealed(page, "/dashboard/inventory");
      const main = page.getByRole("main");
      const isMobile = test.info().project.name === "mobile";
      if (isMobile) {
        const more = main.getByRole("button", { name: locale === "sv" ? "Fler lageråtgärder" : "More inventory actions", exact: true });
        await expectHydrated(more);
        await more.click();
        await page.getByRole("menuitem", { name: c.trigger }).click();
      } else {
        const trigger = main.getByRole("button", { name: c.trigger, exact: true });
        await expectHydrated(trigger);
        await trigger.click();
      }
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      return dialog;
    }

    test("corrects one item, confirms another, and the new amount survives a reload", async ({ page }) => {
      const dialog = await openCheck(page);
      await dialog.getByRole("button", { name: new RegExp(location) }).click();

      // Sorted by name: Alpha first. Its amount is pre-filled; correct it.
      await expect(dialog.getByText(alpha)).toBeVisible();
      const amount = dialog.getByRole("spinbutton");
      await expect(amount).toHaveValue("4");
      await amount.fill("1");
      await dialog.getByRole("button", { name: c.next }).click();

      // Beta: confirm as is.
      await expect(dialog.getByText(beta)).toBeVisible();
      await expect(amount).toHaveValue("2");
      await dialog.getByRole("button", { name: c.next }).click();

      await expect(dialog.getByText(c.summary)).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await dialog.getByRole("button", { name: c.done }).click();
      await expect(dialog).toBeHidden();

      // Saved: only the corrected one changed.
      const rows = await withClient((client) =>
        client.query<{ id: string; quantity: number }>(
          `SELECT id, quantity FROM "InventoryItem" WHERE "householdId" = $1 AND id LIKE $2 ORDER BY id`,
          [E2E_HOUSEHOLD.id, `${idPrefix}%`],
        ),
      );
      expect(rows.rows.map((r) => [r.id.replace(idPrefix, ""), r.quantity])).toEqual([
        ["alpha", 1],
        ["beta", 2],
      ]);
      await page.reload();
      await page.getByRole("searchbox").filter({ visible: true }).fill(alpha);
      // The quantity control's name carries the amount on both layouts
      // (list rows on phones, table rows on desktop).
      await expect(
        page.getByRole("main").getByRole("button", { name: new RegExp(`${alpha} \\(1 (pcs|st)\\)$`) }).filter({ visible: true }),
      ).toBeVisible();
    });

    test("fits a 320 px phone", async ({ page }) => {
      test.skip(test.info().project.name !== "mobile", "phone layout");
      await page.setViewportSize({ width: 320, height: 640 });
      const dialog = await openCheck(page);
      await dialog.getByRole("button", { name: new RegExp(location) }).click();
      await expect(dialog.getByText(alpha)).toBeVisible();
      await expect(dialog.getByRole("button", { name: c.next })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  });
}
