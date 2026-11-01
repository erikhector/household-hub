import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow, expectTouchTargets } from "./ui";

// UX-168: typed (unlinked) rows keep only their "Match item" chip; the
// explanation is one dismissible note per list, with a "Match all" action.
// The list is written straight to Postgres and removed afterwards (only this
// worker's household's rows).
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

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test.afterAll(async () => {
  await sql(`DELETE FROM "ShoppingList" WHERE id LIKE 'e2e-ux168-%' AND "householdId" = $1`, [E2E_HOUSEHOLD.id]);
});

test("two unmatched rows share one explanation, which can be acted on or hidden", async ({ page, isMobile }) => {
  const t = tag();
  const listId = `e2e-ux168-list-${t}`;
  await sql(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, $3)`, [
    listId,
    E2E_HOUSEHOLD.id,
    `Match note ${t}`,
  ]);
  for (const [i, name] of [`Quark ${t}`, `Kefir ${t}`].entries()) {
    await sql(
      `INSERT INTO "ShoppingListItem" (id, "shoppingListId", name, unit, purchased) VALUES ($1, $2, $3, 'pcs', false)`,
      [`e2e-ux168-item-${t}-${i}`, listId, name],
    );
  }
  await page.goto(`/dashboard/shopping-list/${listId}`);

  // Each row keeps its chip; the sentence appears once, with the count.
  await expect(page.getByRole("button", { name: "Match item", exact: true })).toHaveCount(2);
  const note = page.getByRole("main").getByText("2 items aren't in your pantry yet. Match them so buying updates your stock.");
  await expect(note).toHaveCount(1);
  await expect(page.getByText("New to your pantry")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  if (isMobile) await expectTouchTargets(page);

  // "Match all" opens the batch matcher.
  const matchAll = page.getByRole("button", { name: "Match all" });
  await expectHydrated(matchAll);
  await matchAll.click();
  const dialog = page.getByRole("dialog", { name: "Match items to inventory" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole("button", { name: "Hide this note" }).click();
  await expect(note).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Match item", exact: true })).toHaveCount(2);
});
