import { expect, test } from "@playwright/test";
import { dismissCookieNotice } from "./ui";

// UX-42: a button that swaps its label to "Saving…" while its action runs
// keeps the width it had, so nothing next to it moves under the thumb.
// The server action is held for a second so the pending state can be
// measured instead of raced.
test("a saving button keeps its width", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await page.route("**/dashboard/profile", async (route) => {
    if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue();
  });
  await page.goto("/dashboard/profile");
  const name = page.getByLabel("Display name");
  await name.fill(`Width ${Date.now()}`);
  const save = page.getByRole("button", { name: "Save changes" }).first();
  const before = (await save.boundingBox())!;
  await save.click();
  const saving = page.getByRole("button", { name: "Saving…" });
  await expect(saving).toBeVisible();
  const during = (await saving.boundingBox())!;
  expect(during.width).toBeCloseTo(before.width, 0);
  expect(during.height).toBeCloseTo(before.height, 0);
  await expect(page.getByRole("button", { name: "Save changes" }).first()).toBeVisible();
});
