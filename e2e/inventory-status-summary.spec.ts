import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD, E2E_USER } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow, expectTargetsApart } from "./ui";

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
  // UX-166: on a phone the counts sit in the Filters dialog as "Status: 1
  // out" chips (the dialog hides the list behind it, so each tap opens it,
  // taps and closes it); on desktop they head the list.
  const isMobile = test.info().project.name === "mobile";
  await page.goto("/dashboard/inventory");
  const main = page.getByRole("main");
  const search = page.getByRole("searchbox").filter({ visible: true });
  await expect(search).toHaveCount(1);
  await search.fill(prefix);
  const filtersButton = page.getByRole("button", { name: /^Filters/ });
  if (isMobile) await expectHydrated(filtersButton);

  const dialog = page.getByRole("dialog");
  const summary = (isMobile ? dialog : main).getByRole("group", { name: "Needs attention" });
  const chip = (word: string) =>
    summary.getByRole("button", { name: new RegExp(`^${isMobile ? "Status: " : ""}\\d+ ${word}$`) });
  async function openChips() {
    if (isMobile) await filtersButton.click();
    await expect(summary).toBeVisible();
  }
  async function closeChips() {
    if (!isMobile) return;
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toBeHidden();
  }
  // Taps one count and returns whether it is pressed afterwards.
  async function tap(word: string) {
    await openChips();
    await chip(word).click();
    const pressed = await chip(word).getAttribute("aria-pressed");
    await closeChips();
    return pressed;
  }

  const rows = itemRows(page);
  // Status is saved with the view prefs, so start from a clean slate.
  await openChips();
  const pressed = summary.getByRole("button", { pressed: true });
  if ((await pressed.count()) > 0) await pressed.first().click();
  await expect(chip("out")).toBeVisible();
  await expect(chip("low")).toBeVisible();
  await expect(chip("expiring")).toBeVisible();
  await expect(chip("expired")).toBeVisible();
  await expectTargetsApart(summary);
  await closeChips();
  await expect(rows).toHaveCount(5);
  await expectNoHorizontalOverflow(page);

  expect(await tap("out")).toBe("true");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(names.out);

  await tap("low");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(names.low);

  await tap("expiring");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(names.soon);

  await tap("expired");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(names.expired);

  // Tapping the active count again clears the filter.
  expect(await tap("expired")).toBe("false");
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
  // The view pref is saved by a fire-and-forget Server Action (see the
  // persist effect in inventory-client.tsx). Reloading before it has been
  // answered aborts it, the pref never lands and the reload below finds no
  // pressed count under full-suite load. Wait for the save, then reload.
  const saved = page.waitForResponse(
    (r) => r.request().method() === "POST" && "next-action" in r.request().headers(),
  );
  await page.getByRole("option", { name: "Expired" }).click();
  await saved;
  if (isMobile) await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();

  const rows = itemRows(page);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(names.expired);

  // Leave the saved view clean for later specs.
  await page.reload();
  if (isMobile) {
    await expectHydrated(page.getByRole("button", { name: /^Filters/ }));
    await page.getByRole("button", { name: /^Filters/ }).click();
  }
  const clear = (isMobile ? page.getByRole("dialog") : page.getByRole("main"))
    .getByRole("group", { name: "Needs attention" })
    .getByRole("button", { pressed: true });
  await expect(clear).toHaveCount(1);
  await clear.click();
  await expect(clear).toHaveCount(0);
});
