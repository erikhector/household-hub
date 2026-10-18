import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD, E2E_USER } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectNoHorizontalOverflow, expectTargetsApart } from "./ui";

// UX-121: the top of the inventory counts what is out, low, expiring and
// expired as tappable chips that filter the list, and the Status filter
// offers Expiring and Expired. The household holds other workers' and
// specs' rows, so the counts are read, not assumed: the test writes five
// uniquely named items and asserts which of them each filter keeps.
const prefix = `Status ${E2E_WORKER}${Math.random().toString(36).slice(2, 7)}`;
const idPrefix = `e2e-ux121-${E2E_WORKER}-`;
const names = {
  out: `${prefix} out`,
  low: `${prefix} low`,
  soon: `${prefix} soon`,
  expired: `${prefix} expired`,
  fine: `${prefix} fine`,
};

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
    await client.query(
      `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "lowStockThreshold", "expiresAt", "updatedAt")
       VALUES ($1, $6, $7, 'Pantry', 0, 'pcs', 2, NULL, now()),
              ($2, $6, $8, 'Pantry', 1, 'pcs', 2, NULL, now()),
              ($3, $6, $9, 'Pantry', 5, 'pcs', 2, now() + interval '1 day', now()),
              ($4, $6, $10, 'Pantry', 5, 'pcs', 2, now() - interval '2 days', now()),
              ($5, $6, $11, 'Pantry', 5, 'pcs', 2, now() + interval '60 days', now())`,
      [
        `${idPrefix}out`,
        `${idPrefix}low`,
        `${idPrefix}soon`,
        `${idPrefix}expired`,
        `${idPrefix}fine`,
        E2E_HOUSEHOLD.id,
        names.out,
        names.low,
        names.soon,
        names.expired,
        names.fine,
      ],
    );
  });
});

// Only this household's rows: a cleanup by id prefix alone could delete
// another worker's rows mid-test.
test.afterAll(async () => {
  await withClient((client) =>
    client.query(`DELETE FROM "InventoryItem" WHERE "householdId" = $1 AND id LIKE $2`, [E2E_HOUSEHOLD.id, `${idPrefix}%`]),
  );
});

// The Status filter is saved on the user, so even a failed run must not
// leave one behind for the specs that list the inventory after this one.
test.afterEach(async () => {
  await withClient((client) => client.query(`UPDATE "User" SET "inventoryViewPrefs" = NULL WHERE id = $1`, [E2E_USER.id]));
});

// The list is a table on desktop and a list of cards on a phone.
function itemRows(page: Page) {
  const main = page.getByRole("main");
  return main.getByRole("row").or(main.getByRole("listitem")).filter({ hasText: prefix, visible: true });
}

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("tapping a count in the inventory header filters the list", async ({ page }) => {
  await page.goto("/dashboard/inventory");
  const main = page.getByRole("main");
  const summary = main.getByRole("group", { name: "Needs attention" });
  await expect(summary).toBeVisible();
  const search = page.getByRole("searchbox").filter({ visible: true });
  await expect(search).toHaveCount(1);
  await search.fill(prefix);

  const rows = itemRows(page);
  // Status is saved with the view prefs, so start from a clean slate.
  const pressed = summary.getByRole("button", { pressed: true });
  if ((await pressed.count()) > 0) await pressed.first().click();
  await expect(rows).toHaveCount(5);

  const out = summary.getByRole("button", { name: /^\d+ out$/ });
  const low = summary.getByRole("button", { name: /^\d+ low$/ });
  const expiring = summary.getByRole("button", { name: /^\d+ expiring$/ });
  const expired = summary.getByRole("button", { name: /^\d+ expired$/ });
  await expect(out).toBeVisible();
  await expect(low).toBeVisible();
  await expect(expiring).toBeVisible();
  await expect(expired).toBeVisible();
  await expectTargetsApart(summary);
  await expectNoHorizontalOverflow(page);

  await out.click();
  await expect(out).toHaveAttribute("aria-pressed", "true");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(names.out);

  await low.click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(names.low);

  await expiring.click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(names.soon);

  await expired.click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(names.expired);

  // Tapping the active count again clears the filter.
  await expired.click();
  await expect(rows).toHaveCount(5);
});

test("the Status filter offers Expiring and Expired", async ({ page }) => {
  await page.goto("/dashboard/inventory");
  const isMobile = test.info().project.name === "mobile";
  const search = page.getByRole("searchbox").filter({ visible: true });
  await expect(search).toHaveCount(1);
  await search.fill(prefix);

  if (isMobile) await page.getByRole("button", { name: "Filters" }).click();
  const scope = isMobile ? page.getByRole("dialog") : page.getByRole("main");
  await scope.getByRole("combobox").filter({ hasText: /statuses|stock|Expir/ }).first().click();
  await expect(page.getByRole("option", { name: "Expiring soon" })).toBeVisible();
  await page.getByRole("option", { name: "Expired" }).click();
  if (isMobile) await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();

  const rows = itemRows(page);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(names.expired);

  // Leave the saved view clean for later specs.
  await page.reload();
  const clear = page.getByRole("main").getByRole("group", { name: "Needs attention" }).getByRole("button", { pressed: true });
  await expect(clear).toHaveCount(1);
  await clear.click();
  await expect(clear).toHaveCount(0);
});
