import { expect, test } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { budgetTag, insertHouseholdCategory, withDb } from "./budget-seed";
import { dismissCookieNotice, expectHydrated } from "./ui";

// PERF-30: the budget dialogs (Add/Edit transaction, recurring item, planned
// bill, log a shared expense) are separate chunks, mounted the first time
// they're asked to open (src/components/ui/lazy-dialog.tsx). The first tap
// after a hard load must still open one at once, with or without the idle
// prefetch, and a failed chunk load must say so and retry on the next tap.
// The rest of the behaviour is covered by the flow specs that open each
// dialog.
const t = en.budget;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  const tag = budgetTag();
  // Add transaction only appears once there is a category to log against.
  await withDb((client) =>
    insertHouseholdCategory(client, { id: `e2e-lazy-cat-${tag}`, name: `Lazy ${tag}` }),
  );
});

test.describe("without the idle prefetch", () => {
  test.beforeEach(async ({ page }) => {
    // The tap has to fetch the chunk itself and open once it arrives.
    await page.addInitScript(() => {
      window.requestIdleCallback = () => 0;
    });
  });

  test("Add transaction opens its dialog on the first tap", async ({ page }) => {
    await page.goto("/dashboard/budget");
    const add = page.getByRole("button", { name: t.addTransaction }).first();
    await expectHydrated(add);
    await add.click();
    await expect(page.getByRole("dialog", { name: t.addTransactionDialogTitle })).toBeVisible();
  });
});

test.describe("a failed chunk load", () => {
  // No service worker: it would answer the chunk request past page.route(),
  // so the "offline" route below would never fire (see
  // meal-planning-lazy-dialogs.spec.ts).
  test.use({ serviceWorkers: "block" });

  test("says so, and the next tap retries", async ({ page }) => {
    await page.addInitScript(() => {
      window.requestIdleCallback = () => 0;
    });
    await page.goto("/dashboard/budget");
    const add = page.getByRole("button", { name: t.addTransaction }).first();
    await expectHydrated(add);

    // Offline (or a chunk replaced by a deploy): every script fetched from now on fails.
    let offline = true;
    await page.route("**/_next/static/**/*.js", (route) => (offline ? route.abort() : route.continue()));
    await add.click();
    await expect(page.getByText(en.errors.generic)).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    offline = false;
    await add.click();
    await expect(page.getByRole("dialog", { name: t.addTransactionDialogTitle })).toBeVisible();
  });
});
