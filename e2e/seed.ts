import bcrypt from "bcryptjs";
import { Client } from "pg";
import { E2E_SHOPPING_LIST } from "./seed-data";

// A fixed, already-verified account with one household, so specs can log in
// without going through signup + the email-verification gate (which needs a
// real inbox). Writes straight to Postgres rather than through
// src/lib/prisma.ts: that module pulls in the generated client and
// @vercel/functions, neither of which belongs in the Playwright runner.
// Idempotent — every run wipes and recreates the same rows, so a spec that
// mutates data can't leak state into the next run.
export const E2E_USER = {
  id: "e2e-user",
  email: "e2e@squirrel.test",
  password: "e2e-password-123",
  displayName: "E2E Tester",
};
// A second owner of the same household whose account language is Swedish
// (an owner too, so the sv screens show the same owner-only controls).
// Signed-in pages take the locale from the account (User.locale, see
// getLocale()), not the cookie, so the Swedish UI runs need their own login.
export const E2E_USER_SV = {
  id: "e2e-user-sv",
  email: "e2e-sv@squirrel.test",
  password: "e2e-password-123",
  displayName: "E2E Testare",
};
export const E2E_HOUSEHOLD = { id: "e2e-household", name: "E2E Household" };
// Where auth.setup.ts saves the logged-in session for the other specs.
export const STORAGE_STATE = "e2e/.auth/user.json";
export const STORAGE_STATE_SV = "e2e/.auth/user-sv.json";

export async function seed() {
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
    const passwordHash = await bcrypt.hash(E2E_USER.password, 10);
    await client.query("BEGIN");
    // Household first: its members, lists, tasks etc. cascade with it.
    await client.query(`DELETE FROM "Household" WHERE id = $1`, [E2E_HOUSEHOLD.id]);
    for (const [user, locale] of [
      [E2E_USER, "en"],
      [E2E_USER_SV, "sv"],
    ] as const) {
      await client.query(`DELETE FROM "User" WHERE id = $1 OR email = $2`, [user.id, user.email]);
      await client.query(
        `INSERT INTO "User" (id, email, "passwordHash", "displayName", "emailVerifiedAt", locale)
         VALUES ($1, $2, $3, $4, now(), $5)`,
        [user.id, user.email, passwordHash, user.displayName, locale],
      );
    }
    await client.query(`INSERT INTO "Household" (id, name) VALUES ($1, $2)`, [
      E2E_HOUSEHOLD.id,
      E2E_HOUSEHOLD.name,
    ]);
    await client.query(
      `INSERT INTO "HouseholdMember" (id, "householdId", "userId", role)
       VALUES ($1, $2, $3, 'OWNER'), ($4, $2, $5, 'OWNER')`,
      ["e2e-member", E2E_HOUSEHOLD.id, E2E_USER.id, "e2e-member-sv", E2E_USER_SV.id],
    );
    // A list with a couple of rows, so the list detail page has a real URL
    // to visit (e2e/routes.ts) and something other than its empty state to
    // lay out on a phone. Specs that write to lists make their own.
    await client.query(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, $3)`, [
      E2E_SHOPPING_LIST.id,
      E2E_HOUSEHOLD.id,
      E2E_SHOPPING_LIST.name,
    ]);
    await client.query(
      `INSERT INTO "ShoppingListItem" (id, "shoppingListId", name, quantity, unit)
       VALUES ('e2e-item-oat-milk', $1, 'Oat milk', 2, 'l'), ('e2e-item-apples', $1, 'Apples', 6, 'pcs')`,
      [E2E_SHOPPING_LIST.id],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}
