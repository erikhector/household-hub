import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectHydrated, expectRouterPatched } from "./ui";

// UX-185: in the Plan portions sheet, a slot that already has dishes lists
// them in full. They used to sit on one truncated line with the rest only in
// a hover title, which a phone can't reach (M9). Phone-only: that's where
// three long names outgrow one line.
const DAY_MS = 24 * 60 * 60 * 1000;

function mondayOf(day: Date) {
  return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS);
}

// The dialog names each day's group like this (plan-portions-dialog.tsx), in UTC.
const dayGroupName = (day: Date) =>
  new Intl.DateTimeFormat("en", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(day);

async function withClient<T>(run: (client: Client) => Promise<T>) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

test("a slot's planned dishes wrap in full in the plan-portions sheet", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  const id = `${E2E_WORKER}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const recipeId = `e2e-ux185-recipe-${id}`;
  const recipeName = `Prep chili ${id}`;
  const dishes = [
    `Slow-roasted tomato and fennel soup with garlic croutons ${id}`,
    `Grilled halloumi with charred peppers and lemon couscous ${id}`,
    `Sticky toffee pudding with vanilla custard and pecans ${id}`,
  ];
  // A snack next week: one "Next week" away, whatever weekday today is.
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const nextMonday = new Date(mondayOf(today).getTime() + 7 * DAY_MS);
  const day = new Date(nextMonday.getTime() + Math.floor(Math.random() * 7) * DAY_MS);
  const entryIds = dishes.map((_, i) => `e2e-ux185-entry-${id}-${i}`);

  await withClient(async (client) => {
    await client.query(`INSERT INTO "Recipe" (id, "householdId", name, servings) VALUES ($1, $2, $3, 2)`, [
      recipeId,
      E2E_HOUSEHOLD.id,
      recipeName,
    ]);
    await client.query(
      `INSERT INTO "PreparedBatch" (id, "householdId", "recipeId", "totalPortions", "remainingPortions", "updatedAt")
       VALUES ($1, $2, $3, 4, 4, now())`,
      [`e2e-ux185-batch-${id}`, E2E_HOUSEHOLD.id, recipeId],
    );
    await client.query(
      `INSERT INTO "MealPlan" (id, "householdId", "weekStartDate") VALUES ($1, $2, $3)
       ON CONFLICT ("householdId", "weekStartDate") DO NOTHING`,
      [`e2e-ux185-plan-${id}`, E2E_HOUSEHOLD.id, nextMonday],
    );
    // Ids in order, so the dialog (ordered by id) lists them in this order.
    for (const [i, name] of dishes.entries()) {
      await client.query(
        `INSERT INTO "MealPlanEntry" (id, "mealPlanId", date, "mealType", "freeformName")
         SELECT $1, plan.id, $2, 'SNACK', $3
         FROM "MealPlan" plan WHERE plan."householdId" = $4 AND plan."weekStartDate" = $5`,
        [entryIds[i], day, name, E2E_HOUSEHOLD.id, nextMonday],
      );
    }
  });

  try {
    await page.goto("/dashboard/meal-planning?tab=prep");
    const open = page
      .getByRole("listitem")
      .filter({
        has: page.getByRole("heading", { name: recipeName, exact: true }),
      })
      .getByRole("button", { name: "Plan portions" });
    await expectHydrated(open);
    await expectRouterPatched(page);
    await open.click();
    const dialog = page.getByRole("dialog", {
      name: `Plan portions of ${recipeName}`,
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Next week" }).click();
    const group = dialog.getByRole("group", { name: dayGroupName(day) });
    await expect(group).toBeVisible();

    // The dish line under Snack: the smallest element holding the first name.
    const line = group.getByText(dishes[0]);
    await line.scrollIntoViewIfNeeded();
    await expect(line).toBeVisible();
    await expect(line).toContainText(dishes[2]);

    const fit = await line.evaluate((el, names) => {
      const box = el.getBoundingClientRect();
      // Each name's own rectangles, from a Range over its characters.
      const text = el.firstChild as Text;
      const inside = names.map((name) => {
        const start = text.data.indexOf(name);
        const range = document.createRange();
        range.setStart(text, start);
        range.setEnd(text, start + name.length);
        return Array.from(range.getClientRects()).every(
          (r) =>
            r.left >= box.left - 0.5 &&
            r.right <= box.right + 0.5 &&
            r.top >= box.top - 0.5 &&
            r.bottom <= box.bottom + 0.5,
        );
      });
      return {
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        inside,
      };
    }, dishes);

    expect(fit.scrollHeight).toBeLessThanOrEqual(fit.clientHeight);
    expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth);
    // The last dish (and the others) sit inside the line, not clipped past it.
    expect(fit.inside).toEqual([true, true, true]);
  } finally {
    await withClient(async (client) => {
      await client.query(
        `DELETE FROM "MealPlanEntry" entry USING "MealPlan" plan
         WHERE entry."mealPlanId" = plan.id AND plan."householdId" = $1 AND entry.id = ANY($2)`,
        [E2E_HOUSEHOLD.id, entryIds],
      );
      await client.query(`DELETE FROM "Recipe" WHERE id = $1 AND "householdId" = $2`, [recipeId, E2E_HOUSEHOLD.id]);
    });
  }
});
