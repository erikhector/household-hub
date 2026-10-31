import { expect, test, type Route } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { dismissCookieNotice, expectHydrated, expectRouterPatched } from "./ui";
import { E2E_ITEM } from "./seed-data";

// PERF-26: the inventory dialogs (header actions, the row's edit form, the
// item page's Change unit and Merge into) are separate chunks, mounted the
// first time they're asked to open (src/components/ui/lazy-dialog.tsx). The
// first tap after a hard load must still open one at once, with or without
// the idle prefetch, and a failed chunk load must say so and retry on the
// next tap. The rest of the behaviour is covered by the flow specs that open
// each dialog.
const t = en.inventory;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test.describe("without the idle prefetch", () => {
  test.beforeEach(async ({ page }) => {
    // The tap has to fetch the chunk itself and open once it arrives.
    await page.addInitScript(() => {
      window.requestIdleCallback = () => 0;
    });
  });

  test("Add item opens the item form on the first tap", async ({ page }) => {
    await page.goto("/dashboard/inventory");
    const add = page.getByRole("button", { name: t.addItem, exact: true });
    await expectHydrated(add);
    await expectRouterPatched(page);
    await add.click();
    await expect(page.getByRole("dialog", { name: t.addDialogTitle })).toBeVisible();
  });

  test("Change unit opens its dialog on the first tap", async ({ page }) => {
    await page.goto(`/dashboard/inventory/items/${E2E_ITEM.id}`);
    const button = page.getByRole("button", { name: t.itemPage.changeUnit });
    await expectHydrated(button);
    await expectRouterPatched(page);
    await button.click();
    await expect(page.getByRole("dialog", { name: t.itemPage.changeUnitDialog.title })).toBeVisible();
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
    await page.goto("/dashboard/inventory");
    const add = page.getByRole("button", { name: t.addItem, exact: true });
    await expectHydrated(add);
    // The retry's tap opens a dialog, which pushes a history entry: before the
    // app router has patched history.replaceState its first commit rewrites
    // that entry and closes the dialog again (MAINT-69, same race as MAINT-68).
    await expectRouterPatched(page);

    // Offline (or a chunk replaced by a deploy): every script fetched from now on fails.
    // Remember what it refused, to warm the browser's cache for the retry below.
    const refused = new Set<string>();
    const offline = (route: Route) => {
      refused.add(route.request().url());
      return route.abort();
    };
    await page.route("**/_next/static/**/*.js", offline);
    await add.click();
    await expect(page.getByText(en.errors.generic)).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Back online: take the route off rather than flipping a flag inside it.
    // A route that stays (and answers route.continue()) makes the browser
    // wait on this test process, one round trip per script, for every chunk
    // the retry fetches. Under a loaded gate that process is as busy as the
    // server and the browser, and those round trips are what can push the
    // dialog past the 5 s the tap has to open it (MAINT-71). With the route
    // gone the retry measures the app's own chunk load, not the harness.
    await page.unroute("**/_next/static/**/*.js", offline);
    // The retry has 5 s to fetch, parse and mount the chunk. On a gate that is
    // also building, running other specs and serving them, the fetch alone has
    // missed that (MAINT-66, once on bcfddc1, after MAINT-71 took the harness
    // out of the loop). Static chunks are immutable and cached by URL, so
    // fetching the ones the abort refused here, outside the timed window, leaves
    // the tap measuring what it is for: that a failed import is forgotten and
    // the next tap loads it again.
    await page.evaluate((urls) => Promise.all(urls.map((url) => fetch(url).then((response) => response.arrayBuffer()))), [
      ...refused,
    ]);
    await add.click();
    await expect(page.getByRole("dialog", { name: t.addDialogTitle })).toBeVisible();
  });
});
