import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
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
  await expect(page.getByLabel("Running low below")).toHaveAttribute("inputmode", "decimal");
});

test("the budget transaction amount field asks for the decimal pad and the last field for Done", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  // "Add transaction" is disabled until the household has a category, and the
  // seed has none, so write one straight to Postgres (uniquely named: the
  // desktop and mobile runs share the household).
  const tag = `${Date.now().toString(36)}-w${E2E_WORKER}`;
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

// UX-120/UX-156: "Running low below" is strict (quantity < the number), so a
// piece count starts at 1 (never above the default quantity of 1, or the
// first item would read "Low stock") and a weight starts empty, because
// there's no natural level for grams.
test("the add-item running-low field defaults to the unit", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await page.goto("/dashboard/inventory");
  await page.getByRole("button", { name: "Add item" }).first().click();

  const field = page.getByLabel("Running low below");
  await expect(field).toHaveValue("1");

  await page.getByRole("combobox", { name: "Unit" }).fill("g");
  await expect(field).toHaveValue("");
});
