import { expect, test } from "@playwright/test";
import { cleanUp, seedList, tag } from "./ux-79-seed";
import { dismissCookieNotice } from "./ui";

// UX-79: on a phone a row's "Add price" lives in its ⋯ menu (the row is
// one line, see ux-79.mobile.spec.ts); from sm it's still on the row. Both
// open the same inline editor.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test.afterAll(cleanUp);

test("a row's price is added from the ⋯ on a phone, and the ⋯ stays a 44 px target", async ({ page }) => {
  const { path, names } = await seedList(tag(), 3);
  await page.goto(path);
  const name = names[0];

  if (page.viewportSize()!.width < 640) {
    // No "Add price" crowding the name's line; the ⋯ carries it.
    await expect(page.getByRole("button", { name: `Add an estimated price for ${name}` })).toBeHidden();
    const more = page.getByRole("button", { name: `More actions for ${name}` });
    const box = (await more.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    await more.click();
    await page.getByRole("menuitem", { name: "Add price" }).click();
  } else {
    await page.getByRole("button", { name: `Add an estimated price for ${name}` }).click();
  }

  const input = page.getByRole("spinbutton", { name: `Estimated price for ${name}` });
  await expect(input).toBeFocused();
  await input.fill("24");
  await page.getByRole("button", { name: "Save price" }).click();

  // Saved (the editor closes only once the server has answered): the ≈
  // price stays on the row after a reload.
  await expect(input).toBeHidden();
  await page.reload();
  await expect(page.getByRole("button", { name: `Edit estimated price for ${name}` })).toContainText("24");
});
