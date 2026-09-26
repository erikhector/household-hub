import bcrypt from "bcryptjs";
import { Client } from "pg";

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
export const E2E_HOUSEHOLD = { id: "e2e-household", name: "E2E Household" };
// Where auth.setup.ts saves the logged-in session for the other specs.
export const STORAGE_STATE = "e2e/.auth/user.json";

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
    await client.query(`DELETE FROM "User" WHERE id = $1 OR email = $2`, [E2E_USER.id, E2E_USER.email]);
    await client.query(
      `INSERT INTO "User" (id, email, "passwordHash", "displayName", "emailVerifiedAt")
       VALUES ($1, $2, $3, $4, now())`,
      [E2E_USER.id, E2E_USER.email, passwordHash, E2E_USER.displayName],
    );
    await client.query(`INSERT INTO "Household" (id, name) VALUES ($1, $2)`, [
      E2E_HOUSEHOLD.id,
      E2E_HOUSEHOLD.name,
    ]);
    await client.query(
      `INSERT INTO "HouseholdMember" (id, "householdId", "userId", role) VALUES ($1, $2, $3, 'OWNER')`,
      ["e2e-member", E2E_HOUSEHOLD.id, E2E_USER.id],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}
