import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-75: an owner renames the household from the Household page and the new
// name shows after a reload. The seeded user is the household's owner. The
// name is restored afterwards so no other spec sees the change.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test.afterEach(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`UPDATE "Household" SET name = $1 WHERE id = $2`, [E2E_HOUSEHOLD.name, E2E_HOUSEHOLD.id]);
  } finally {
    await client.end();
  }
});

test("an owner renames the household and the new name survives a reload", async ({ page }) => {
  const newName = `Renamed ${Date.now().toString(36)}`;

  await page.goto("/dashboard/household");
  const field = page.getByRole("textbox", { name: "Name", exact: true });
  const save = page.getByRole("button", { name: "Save name" });
  // Nothing to save until the name actually changes.
  await expect(save).toBeDisabled();

  await field.fill(newName);
  await save.click();
  await expect(page.getByText("Household renamed")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.reload();
  await expect(page.getByRole("main").getByText(newName, { exact: true })).toBeVisible();
  await expect(field).toHaveValue(newName);
});

test("a blank name is refused and the old name stays", async ({ page }) => {
  await page.goto("/dashboard/household");
  const field = page.getByRole("textbox", { name: "Name", exact: true });
  await field.fill("   ");
  await page.getByRole("button", { name: "Save name" }).click();
  // The field is required, so the browser stops a truly empty value; a
  // whitespace-only one reaches the server, which rejects it.
  await expect(page.getByText("Household name is required")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("main").getByText(E2E_HOUSEHOLD.name, { exact: true })).toBeVisible();
});
