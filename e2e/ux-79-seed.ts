import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";

// Shared by ux-79.spec.ts and ux-79.mobile.spec.ts. Lists are written
// straight to Postgres, named uniquely and removed again afterwards (only
// this worker's household's rows).
export const tag = () => `${Date.now().toString(36)}-w${E2E_WORKER}`;

async function sql(text: string, values: unknown[] = []) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(text, values);
  } finally {
    await client.end();
  }
}

export async function seedList(t: string, count: number) {
  const listId = `e2e-ux79-list-${t}`;
  await sql(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, $3)`, [
    listId,
    E2E_HOUSEHOLD.id,
    `Weekly shop ${t}`,
  ]);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const name = `Thing ${String(i).padStart(2, "0")} ${t}`;
    names.push(name);
    const inventoryId = `e2e-ux79-inv-${t}-${i}`;
    await sql(
      `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "updatedAt")
       VALUES ($1, $2, $3, $4, 0, 'pcs', now())`,
      [inventoryId, E2E_HOUSEHOLD.id, name, `Aisle ${t}`],
    );
    await sql(
      `INSERT INTO "ShoppingListItem" (id, "shoppingListId", name, unit, purchased, "inventoryItemId")
       VALUES ($1, $2, $3, 'pcs', false, $4)`,
      [`e2e-ux79-item-${t}-${i}`, listId, name, inventoryId],
    );
  }
  return { path: `/dashboard/shopping-list/${listId}`, names };
}

export async function cleanUp() {
  for (const table of ["ShoppingList", "InventoryItem"]) {
    await sql(`DELETE FROM "${table}" WHERE id LIKE 'e2e-ux79-%' AND "householdId" = $1`, [E2E_HOUSEHOLD.id]);
  }
}
