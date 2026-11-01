import { expect, test, type Page } from "@playwright/test";
import { dismissCookieNotice, expectHydrated, openRecipesTab } from "./ui";

// GAP-54: "Import from a photo" in the recipe form. The vision call is
// mocked at the Server Action POST (the same technique as
// manual-receipt-prices.spec.ts), so no provider is contacted. The webServer
// env in playwright.config.ts sets a placeholder GEMINI_API_KEY, which is
// what makes the page show the button at all.

// A valid 1x1 PNG: fileToResizedDataUrl needs a decodable image to get as
// far as the action.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Answers the photo action (the only meal-planning POST carrying an image)
 * with `payload`, the way a Server Action answer is framed. */
async function mockPhotoAction(page: Page, payload: unknown) {
  await page.route(
    (url) => url.pathname.startsWith("/dashboard/meal-planning"),
    async (route) => {
      const request = route.request();
      if (request.method() === "POST" && (request.postData() ?? "").includes("data:image")) {
        await route.fulfill({
          status: 200,
          contentType: "text/x-component",
          body: `0:{"a":"$@1","f":"","b":"e2e"}\n1:${JSON.stringify(payload)}\n`,
        });
        return;
      }
      await route.continue();
    },
  );
}

async function openNewRecipe(page: Page) {
  await page.goto("/dashboard/meal-planning");
  await openRecipesTab(page);
  await page.getByRole("button", { name: "New recipe" }).click();
  const dialog = page.getByRole("dialog", { name: "New recipe" });
  await expect(dialog).toBeVisible();
  // MAINT-76: the photo is read through a Server Action, and Next's client
  // runs actions one at a time, behind whatever else is in flight. Under a
  // loaded runner the Recipes tab's own fetches (the lazy dialog chunk, route
  // prefetches) can still be pending when the dialog shows, and the action,
  // and so the toast the test waits on, queues behind them past the 5 s
  // assertion timeout. Let the page go quiet, and make sure React owns the
  // file input, before the photo is chosen. The assertions stay as strict.
  await page.waitForLoadState("networkidle");
  await expectHydrated(dialog.locator('input[type="file"]'));
  return dialog;
}

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("a photo pre-fills the name and ingredient rows, and nothing is saved until Save", async ({ page }) => {
  const name = `Photo pancakes ${Date.now().toString(36)}`;
  await mockPhotoAction(page, {
    recipe: {
      name,
      instructions: "Whisk the batter.\nFry in butter.",
      ingredients: [
        { name: "flour", quantity: 2, unit: "dl", rawText: "2 dl flour" },
        { name: "eggs", quantity: 3, unit: "pcs", rawText: "3 eggs" },
      ],
    },
  });

  const dialog = await openNewRecipe(page);
  await expect(dialog.getByRole("button", { name: "Import from a photo" })).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles({ name: "recipe.png", mimeType: "image/png", buffer: PNG });

  await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue(name);
  await expect(dialog.getByRole("textbox", { name: "Instructions" })).toHaveValue("Whisk the batter.\nFry in butter.");
  await expect(dialog.getByPlaceholder("Ingredient")).toHaveCount(2);
  await expect(dialog.getByPlaceholder("Ingredient").first()).toHaveValue("flour");
  await expect(dialog.getByPlaceholder("Qty").first()).toHaveValue("2");
  await expect(dialog.getByPlaceholder("Unit").first()).toHaveValue("dl");
  await expect(dialog.getByPlaceholder("Ingredient").nth(1)).toHaveValue("eggs");

  // Nothing was saved by importing: close without submitting, reload, and
  // the recipe isn't in the list.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.goto("/dashboard/meal-planning");
  await openRecipesTab(page);
  await expect(page.getByText(name)).toHaveCount(0);
});

test("a failed read shows an error toast and leaves the form untouched", async ({ page }) => {
  await mockPhotoAction(page, { error: "Couldn't find a recipe in that photo. Try a sharper, closer shot." });

  const dialog = await openNewRecipe(page);
  const nameInput = dialog.getByRole("textbox", { name: "Name" });
  await nameInput.fill("My own draft");
  await dialog.locator('input[type="file"]').setInputFiles({ name: "recipe.png", mimeType: "image/png", buffer: PNG });

  await expect(page.getByText("Couldn't find a recipe in that photo. Try a sharper, closer shot.")).toBeVisible();
  await expect(nameInput).toHaveValue("My own draft");
  await expect(dialog.getByPlaceholder("Ingredient")).toHaveCount(1);
  await expect(dialog.getByPlaceholder("Ingredient")).toHaveValue("");
});
