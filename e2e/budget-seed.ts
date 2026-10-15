import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";

// Direct Postgres inserts for the budget phone-pass specs (budget-*.spec.ts),
// the same way budget-balances.spec.ts and personal-budget-*.spec.ts seed:
// faster than clicking through the forms, and each spec sets up exactly
// what it needs. Every id carries E2E_WORKER and a fresh tag, so parallel
// workers and the desktop/mobile runs never touch each other's rows.

export function budgetTag() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}-w${E2E_WORKER}`;
}

/** Today's calendar day (the runner's), stored as the forms store a date:
 * UTC midnight. */
export function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export async function withDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function insertHouseholdCategory(
  client: Client,
  { id, name, type = "EXPENSE" }: { id: string; name: string; type?: "INCOME" | "EXPENSE" | "SAVINGS" },
) {
  await client.query(`INSERT INTO "BudgetCategory" (id, "householdId", name, type) VALUES ($1, $2, $3, $4)`, [
    id,
    E2E_HOUSEHOLD.id,
    name,
    type,
  ]);
}

export async function insertHouseholdTransaction(
  client: Client,
  {
    id,
    categoryId,
    amount,
    description = null,
    date = todayUtc(),
    type = "EXPENSE",
  }: {
    id: string;
    categoryId: string;
    amount: number;
    description?: string | null;
    date?: Date;
    type?: "INCOME" | "EXPENSE" | "SAVINGS";
  },
) {
  await client.query(
    `INSERT INTO "Transaction" (id, "householdId", "categoryId", amount, type, description, date)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    // A zone-less timestamp, as Prisma writes it: the column has no time
    // zone, so node-pg's local-time Date serialisation could shift it.
    [id, E2E_HOUSEHOLD.id, categoryId, amount, type, description, date.toISOString().replace("Z", "")],
  );
}
