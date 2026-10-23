import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

// SEC-10: "Export my data" on the Profile page downloads the signed-in
// user's own data, including their part of shared features. A note written
// through the UI must turn up in the file the button downloads, and the
// response must never be cacheable. The exact key set is pinned by the
// route's unit test; this proves the real query and download work end to end.
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

test("export my data includes a note I wrote and isn't cached", async ({ page }) => {
  const note = unique("Plumber comes Thursday");
  await page.goto("/dashboard/household");
  await page.getByRole("textbox", { name: "New note" }).fill(note);
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText(note)).toBeVisible();

  await page.goto("/dashboard/profile");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export my data" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^squirrel-my-data-\d{4}-\d{2}-\d{2}\.json$/);

  const data = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(data.householdNotes.map((n: { body: string }) => n.body)).toContain(note);
  expect(data).toHaveProperty("preferences.locale");
  expect(data).toHaveProperty("pushSubscriptions");
  expect(data).toHaveProperty("householdTasks");
  expect(data).toHaveProperty("transactionSplits");
  expect(data).toHaveProperty("memberSettlements");
  expect(JSON.stringify(data)).not.toContain("passwordHash");

  const response = await page.request.get("/dashboard/profile/export-data");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
});
