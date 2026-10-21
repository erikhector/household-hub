import bcrypt from "bcryptjs";
import { Client } from "pg";
import { E2E_PASSWORD, E2E_WORKER, e2eWorkerData } from "./seed-data";

// This worker's seeded users and household (see e2e/seed-data.ts).
const current = e2eWorkerData(E2E_WORKER);
export const E2E_USER = current.user;
export const E2E_USER_SV = current.userSv;
export const E2E_HOUSEHOLD = current.household;
export const E2E_MEMBER = current.member;
export const E2E_MEMBER_SV = current.memberSv;
export const STORAGE_STATE = current.storageState;
export const STORAGE_STATE_SV = current.storageStateSv;

// Seeds one household per Playwright worker, so `workers` copies.
export async function seed(workers: number) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must be set to seed e2e data");
  // Guard against pointing the suite at a real database: the wipe below
  // only touches the e2e rows, but the specs themselves create and delete
  // data through the app.
  if (process.env.E2E_ALLOW_REMOTE_DB !== "true" && !/@(localhost|127\.0\.0\.1|postgres)[:/]/.test(databaseUrl)) {
    throw new Error("Refusing to seed a non-local database (set E2E_ALLOW_REMOTE_DB=true to override)");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const passwordHash = await bcrypt.hash(E2E_PASSWORD, 10);
    await client.query("BEGIN");
    for (let worker = 0; worker < workers; worker++) {
      await seedWorker(client, e2eWorkerData(worker), passwordHash);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

async function seedWorker(client: Client, data: ReturnType<typeof e2eWorkerData>, passwordHash: string) {
  const { id, household, user, userSv, shoppingList, item } = data;
  // Household first: its members, lists, tasks etc. cascade with it.
  await client.query(`DELETE FROM "Household" WHERE id = $1`, [household.id]);
  for (const [u, locale] of [
    [user, "en"],
    [userSv, "sv"],
  ] as const) {
    await client.query(`DELETE FROM "User" WHERE id = $1 OR email = $2`, [u.id, u.email]);
    await client.query(
      `INSERT INTO "User" (id, email, "passwordHash", "displayName", "emailVerifiedAt", locale)
       VALUES ($1, $2, $3, $4, now(), $5)`,
      [u.id, u.email, passwordHash, u.displayName, locale],
    );
  }
  await client.query(`INSERT INTO "Household" (id, name) VALUES ($1, $2)`, [household.id, household.name]);
  await client.query(
    `INSERT INTO "HouseholdMember" (id, "householdId", "userId", role)
     VALUES ($1, $2, $3, 'OWNER'), ($4, $2, $5, 'OWNER')`,
    [data.member, household.id, user.id, data.memberSv, userSv.id],
  );
  // A list with a couple of rows, so the list detail page has a real URL
  // to visit (e2e/routes.ts) and something other than its empty state to
  // lay out on a phone. Specs that write to lists make their own.
  await client.query(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, $3)`, [
    shoppingList.id,
    household.id,
    shoppingList.name,
  ]);
  await client.query(
    `INSERT INTO "ShoppingListItem" (id, "shoppingListId", name, quantity, unit)
     VALUES ($2, $1, 'Oat milk', 2, 'l'), ($3, $1, 'Apples', 6, 'pcs')`,
    [shoppingList.id, id("e2e-item-oat-milk"), id("e2e-item-apples")],
  );
  // Pantry items for e2e/recipe-ingredients.spec.ts (MATCH-1/2): its
  // recipes name one exactly ("Olive oil"), one only loosely ("Tomater"
  // for "Tomatoes"), and one by its plural ("eggs" for "Egg", which the
  // review then learns as an alias).
  await client.query(
    `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "updatedAt")
     VALUES ($2, $1, 'Tomatoes', 'Produce', 6, 'pcs', now()),
            ($3, $1, 'Olive oil', 'Pantry', 1, 'l', now()),
            ($4, $1, 'Egg', 'Dairy & eggs', 12, 'pcs', now())`,
    [household.id, id("e2e-inv-tomatoes"), id("e2e-inv-olive-oil"), id("e2e-inv-egg")],
  );
  // The item page's seeded row (MATCH-6, e2e/routes.ts): flour counted in
  // bags, with "1 pcs = 2000 g" saved, used by one recipe in grams (✓) and
  // one in dl (⚠), on the seeded list, and a learned name. No template:
  // a seeded one adds a "Start from" choice to the New list sheet that
  // flows.spec.ts's blank-list flow would have to step around.
  await client.query(
    `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "lowStockThreshold", "updatedAt")
     VALUES ($1, $2, $3, 'Baking', 1, 'pcs', 0.5, now())`,
    [item.id, household.id, item.name],
  );
  await client.query(
    `INSERT INTO "ItemUnitConversion" (id, "inventoryItemId", "fromUnit", factor) VALUES ($2, $1, 'g', 0.0005)`,
    [item.id, id("e2e-conv-flour-g")],
  );
  await client.query(
    `INSERT INTO "ItemAlias" (id, "householdId", "normalizedName", "inventoryItemId")
     VALUES ($3, $1, 'vetemjöl', $2)`,
    [household.id, item.id, id("e2e-alias-flour")],
  );
  const buns = id("e2e-recipe-buns");
  const pancakes = id("e2e-recipe-pancakes");
  await client.query(
    `INSERT INTO "Recipe" (id, "householdId", name, instructions) VALUES ($2, $1, 'Cinnamon buns', NULL), ($3, $1, 'Pancakes', E'Whisk the batter\nFry the pancakes'), ($4, $1, 'Porridge', E'Stir in the oats\nSimmer for 10-12 minutes')`,
    [household.id, buns, pancakes, id("e2e-recipe-porridge")],
  );
  await client.query(
    `INSERT INTO "RecipeIngredient" (id, "recipeId", "inventoryItemId", name, quantity, unit)
     VALUES ($2, $3, $1, 'Wheat flour', 750, 'g'),
            ($4, $5, $1, 'Wheat flour', 3, 'dl')`,
    [item.id, id("e2e-ing-buns-flour"), buns, id("e2e-ing-pancakes-flour"), pancakes],
  );
  await client.query(
    `INSERT INTO "ShoppingListItem" (id, "shoppingListId", "inventoryItemId", name, quantity, unit)
     VALUES ($3, $1, $2, 'Wheat flour', 1, 'pcs')`,
    [shoppingList.id, item.id, id("e2e-item-flour")],
  );
  // A possible-duplicate pair for the item catalog (MATCH-7, e2e/routes.ts),
  // so its duplicates view has a group to lay out: the same name, one in
  // stock in pcs and one never stocked in dl, which a merge would ask a
  // factor for. e2e/item-catalog.spec.ts merges and dismisses its own pairs.
  await client.query(
    `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "updatedAt")
     VALUES ($2, $1, 'Crème fraiche', 'Dairy & eggs', 2, 'pcs', now()),
            ($3, $1, 'crème fraiche', 'Dairy & eggs', 0, 'dl', now())`,
    [household.id, id("e2e-inv-creme"), id("e2e-inv-creme-dl")],
  );
}
