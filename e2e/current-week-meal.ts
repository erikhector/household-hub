import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";

// UX-50: a week with nothing planned is one empty state, with no day cards
// and so no "Today" card. A spec about today's card therefore plans one
// meal today first, and removes it afterwards (by id, in E2E_HOUSEHOLD only).
export async function withCurrentWeekMeal(tag: string, run: () => Promise<void>) {
  const entryId = `e2e-curweek-${E2E_WORKER}-${tag}`;
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // Same Monday as getWeekStart (src/app/dashboard/meal-planning/date-utils.ts).
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "MealPlan" (id, "householdId", "weekStartDate") VALUES ($1, $2, $3)
       ON CONFLICT ("householdId", "weekStartDate") DO NOTHING`,
      [`e2e-curweek-plan-${E2E_WORKER}-${tag}`, E2E_HOUSEHOLD.id, monday],
    );
    await client.query(
      `INSERT INTO "MealPlanEntry" (id, "mealPlanId", date, "mealType", "freeformName", portions)
       SELECT $1, plan.id, $2, 'DINNER', 'Planned for today', 2
       FROM "MealPlan" plan WHERE plan."householdId" = $3 AND plan."weekStartDate" = $4`,
      [entryId, today, E2E_HOUSEHOLD.id, monday],
    );
    await run();
  } finally {
    await client.query(`DELETE FROM "MealPlanEntry" WHERE id = $1`, [entryId]);
    await client.end();
  }
}
