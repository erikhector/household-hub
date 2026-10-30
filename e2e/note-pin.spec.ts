import { expect, test } from "@playwright/test";
import { expectHydrated } from "./ui";

// GAP-61: a note can be pinned to the top of the household notes board. Two
// notes are added (the second is newer), the older one is pinned, and after a
// reload it must sit above the newer one with a visible "Pinned" label; then
// it's unpinned and the newest-first order returns. Unpinning at the end also
// keeps the household under the five-pin cap for later specs.
const unique = (label: string) =>
  `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test("a pinned note stays above a newer one until it is unpinned", async ({ page }) => {
  const older = unique("Wifi code is on the router");
  const newer = unique("Out of coffee");

  await page.goto("/dashboard/household");
  await expectHydrated(page.getByRole("textbox", { name: "New note" }));
  for (const body of [older, newer]) {
    await page.getByRole("textbox", { name: "New note" }).fill(body);
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByText(body)).toBeVisible();
    // The form clears itself once the action resolves; filling the next note
    // before that would have the late clear wipe it.
    await expect(page.getByRole("textbox", { name: "New note" })).toHaveValue("");
  }

  const row = (body: string) => page.getByRole("listitem").filter({ hasText: body });
  const top = async (a: string, b: string) => {
    const boxA = await row(a).boundingBox();
    const boxB = await row(b).boundingBox();
    return boxA!.y < boxB!.y;
  };

  // Newest first by default.
  expect(await top(newer, older)).toBe(true);

  await row(older).getByRole("button", { name: /^Pin note by/ }).click();
  await expect(row(older).getByText("Pinned")).toBeVisible();

  await page.reload();
  await expect(row(older).getByText("Pinned")).toBeVisible();
  await expect(row(newer).getByText("Pinned")).toHaveCount(0);
  expect(await top(older, newer)).toBe(true);

  await expectHydrated(row(older).getByRole("button", { name: /^Unpin note by/ }));
  await row(older).getByRole("button", { name: /^Unpin note by/ }).click();
  await expect(row(older).getByText("Pinned")).toHaveCount(0);
  await page.reload();
  await expect(row(older).getByText("Pinned")).toHaveCount(0);
  expect(await top(newer, older)).toBe(true);
});
