import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { dismissCookieNotice } from "./ui";

// UX-7 (DESIGN.md M4): a money or quantity field has to open the number pad
// (with a decimal key), not the full keyboard, and a dialog's last field has
// to give the phone a "Done" key. `type="number"` alone doesn't pick the
// right pad on every phone, so the attribute is asserted directly. Runs on
// both projects: the attribute is the same, only the phone acts on it.

test("the add-item quantity field asks for the decimal pad", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await page.goto("/dashboard/inventory");
  await page.getByRole("button", { name: "Add item" }).first().click();

  await expect(page.getByLabel("Quantity")).toHaveAttribute("inputmode", "decimal");
  await expect(page.getByLabel("Low stock at")).toHaveAttribute("inputmode", "decimal");
});

test("the budget transaction amount field asks for the decimal pad and the last field for Done", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  // "Add transaction" is disabled until the household has a category, and the
  // seed has none, so write one straight to Postgres (uniquely named: the
  // desktop and mobile runs share the household).
  const tag = Date.now().toString(36);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "BudgetCategory" (id, "householdId", name, type) VALUES ($1, $2, $3, 'EXPENSE')`,
      [`e2e-kbd-cat-${tag}`, E2E_HOUSEHOLD.id, `Keyboards ${tag}`],
    );
  } finally {
    await client.end();
  }
  await page.goto("/dashboard/budget");
  await page.getByRole("button", { name: "Add transaction" }).first().click();

  await expect(page.getByLabel("Amount")).toHaveAttribute("inputmode", "decimal");
  await expect(page.getByLabel("Description")).toHaveAttribute("enterkeyhint", "done");
});
