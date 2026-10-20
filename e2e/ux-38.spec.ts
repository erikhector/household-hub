import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-38: the squirrel mark in empty states, and one small celebration when
// the last thing on a shopping list is ticked. Lists are written straight to
// Postgres, named uniquely, and removed again afterwards (only this worker's
// household's rows).
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

async function seedList(t: string, items: string[]) {
  const listId = `e2e-ux38-list-${t}`;
  await sql(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, $3)`, [
    listId,
    E2E_HOUSEHOLD.id,
    `Shop ${t}`,
  ]);
  for (const [i, name] of items.entries()) {
    await sql(
      `INSERT INTO "ShoppingListItem" (id, "shoppingListId", name, unit) VALUES ($1, $2, $3, 'pcs')`,
      [`e2e-ux38-item-${t}-${i}`, listId, name],
    );
  }
  return `/dashboard/shopping-list/${listId}`;
}

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test.afterAll(async () => {
  await sql(`DELETE FROM "ShoppingList" WHERE id LIKE 'e2e-ux38-%' AND "householdId" = $1`, [E2E_HOUSEHOLD.id]);
});

test("an empty shopping list shows the squirrel mark", async ({ page }) => {
  await page.goto(await seedList(tag(), []));
  const main = page.getByRole("main");
  await expect(main.getByRole("img", { name: "Squirrel mascot" })).toBeVisible();
  await expect(main.getByText("Nothing on this list yet", { exact: false })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("ticking the last item celebrates once, and only on the tick", async ({ page }) => {
  const t = tag();
  const path = await seedList(t, [`Oats ${t}`, `Honey ${t}`]);
  await page.goto(path);

  const main = page.getByRole("main");
  const mascot = main.getByRole("img", { name: "Squirrel mascot" });
  const dock = page.getByRole("region", { name: "Next up" });
  const progress = dock.getByRole("progressbar", { name: "Shopping progress" });

  // A tick is saved by a server action; Next queues those, so the second
  // tick's POST goes out only after the first has answered. Waiting for each
  // one's own response keeps the reload below from racing a write still in
  // flight (an earlier version registered its wait after the first click and
  // so could match the first tick's response instead of the last one's).
  const isSave = (response: import("@playwright/test").Response) =>
    response.request().method() === "POST" && "next-action" in response.request().headers();

  // Not yet: one item still to get.
  const firstSaved = page.waitForResponse(isSave);
  await dock.getByRole("button", { name: /, into the cart$/ }).first().click();
  await expect(progress).toHaveAttribute("aria-valuetext", "1 of 2");
  await expect(mascot).toHaveCount(0);
  await firstSaved;

  // The last tick: the full ring with the squirrel in it, exactly once.
  const saved = page.waitForResponse(isSave);
  await dock.getByRole("button", { name: /, into the cart$/ }).first().click();
  await expect(main.getByText("All done", { exact: true })).toBeVisible();
  await expect(mascot).toHaveCount(1);
  await expect(mascot).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await saved;

  // Opening a list that's already all ticked is calm: the plain check, no squirrel.
  await page.reload();
  await expect(main.getByText("All done", { exact: true })).toBeVisible();
  await expect(mascot).toHaveCount(0);
});

test("under reduced motion the celebration is a still image", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const t = tag();
  await page.goto(await seedList(t, [`Salt ${t}`]));

  // Ticking the only item clears the list, and the server action records a
  // "list cleared" notification. Wait for that save: left in flight, it can
  // land after the next test's DELETE of this household's notifications and
  // leave its history non-empty (MAINT-29).
  const saved = page.waitForResponse(
    (response) => response.request().method() === "POST" && "next-action" in response.request().headers(),
  );
  await page.getByRole("region", { name: "Next up" }).getByRole("button", { name: /, into the cart$/ }).click();
  const mascot = page.getByRole("main").getByRole("img", { name: "Squirrel mascot" });
  await expect(mascot).toBeVisible();
  // The rise is motion-safe only, so nothing animates the mark (or its tile).
  const animation = await mascot.evaluate((img) => getComputedStyle(img.parentElement!).animationName);
  expect(animation).toBe("none");
  await saved;
});

test("the empty notification history shows the squirrel mark", async ({ page }) => {
  // Other specs can raise real notifications in this household; clear them
  // so the history is empty (same as notifications-empty-state.spec.ts).
  await sql(`DELETE FROM "Notification" WHERE "householdId" = $1`, [E2E_HOUSEHOLD.id]);
  await page.goto("/dashboard/notifications");
  await expect(page.getByRole("main").getByRole("img", { name: "Squirrel mascot" })).toBeVisible();
});
