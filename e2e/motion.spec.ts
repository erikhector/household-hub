import { expect, test, type Locator, type Page } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { E2E_ITEM } from "./seed-data";
import { dismissCookieNotice } from "./ui";

// UX-33: the motion system. React's <ViewTransition> drives the browser's
// View Transitions API, whose animations run on pseudo-elements that no
// locator can reach, so each test records them instead: an init script
// wraps document.startViewTransition and, once each transition is ready,
// notes every running view-transition animation (which pseudo-element,
// which keyframes, how long). Layout shifts are collected the way
// cls.spec.ts does (ignoring the 500 ms after a tap or key).
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

type VtAnimation = { pseudo: string; keyframes: string; duration: number };

test.beforeEach(async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await page.addInitScript(() => {
    const w = window as unknown as { __vt: VtAnimation[][]; __cls: number };
    w.__vt = [];
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
        if (!entry.hadRecentInput) w.__cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });

    const start = Document.prototype.startViewTransition;
    if (!start) return;
    Document.prototype.startViewTransition = function (this: Document, ...args: Parameters<typeof start>) {
      const transition = start.apply(this, args);
      transition.ready.then(
        () => {
          w.__vt.push(
            document.getAnimations().flatMap((animation) => {
              const pseudo = (animation.effect as KeyframeEffect | null)?.pseudoElement ?? "";
              if (!pseudo.startsWith("::view-transition")) return [];
              return [
                {
                  pseudo,
                  keyframes: (animation as CSSAnimation).animationName ?? "",
                  duration: Number(animation.effect?.getComputedTiming().duration ?? 0),
                },
              ];
            }),
          );
        },
        // Skipped (React skips one when an urgent update lands before
        // the snapshot): nothing ran, so nothing to note.
        () => {},
      );
      return transition;
    };
  });
});

async function recorded(page: Page) {
  return page.evaluate(() => (window as unknown as { __vt: VtAnimation[][] }).__vt.flat());
}

// Starts a fresh recording once the page has settled. A navigation tapped
// while the page is still hydrating, or before the link's prefetch (which
// starts when it scrolls into view) is back, commits without a view
// transition, so a click straight after goto() or a scroll would test
// nothing a person does: they look at a row before they tap it.
async function resetRecording(page: Page, before?: Locator) {
  await before?.scrollIntoViewIfNeeded();
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => {
    const w = window as unknown as { __vt: VtAnimation[][]; __cls: number };
    w.__vt = [];
    w.__cls = 0;
  });
}

async function cls(page: Page) {
  return page.evaluate(() => (window as unknown as { __cls: number }).__cls);
}

/** Waits until a recorded animation matches, then returns it. */
async function expectAnimation(page: Page, match: (animation: VtAnimation) => boolean, what: string) {
  await expect.poll(async () => (await recorded(page)).some(match), { message: what }).toBe(true);
  return (await recorded(page)).find(match)!;
}

async function newListWithItems(page: Page, items: string) {
  const name = unique("Motion shop");
  await page.goto("/dashboard/shopping-list");
  await page.getByRole("button", { name: "New list" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await page.getByRole("button", { name: "Create list" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await resetRecording(page);
  const addBox = page.getByRole("combobox", { name: "Add to the list" });
  await addBox.fill(items);
  await addBox.press("Enter");
  return name;
}

test("adding, ticking and removing shopping items animate without shifting the layout", async ({ page }) => {
  await newListWithItems(page, "motion milk, motion bread");
  await expect(page.getByRole("checkbox", { name: /motion milk/ })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /motion bread/ })).toBeVisible();
  // Add: the new rows rise in.
  await expectAnimation(
    page,
    (a) => a.pseudo.startsWith("::view-transition-new(shopping-item-") && a.keyframes === "vt-fade-in",
    "an added row fades in",
  );
  expect(await cls(page)).toBe(0);

  // Tick: once the save lands, the row travels to "Purchased" on the
  // spring (a paired move, not a delete and an add).
  await resetRecording(page);
  await page.getByRole("checkbox", { name: /motion milk/ }).click();
  const purchased = page.getByRole("main").getByText(en.shoppingList.purchased, { exact: true });
  await expect(purchased).toBeVisible();
  const move = await expectAnimation(
    page,
    (a) => a.pseudo.startsWith("::view-transition-group(shopping-item-") && a.duration === 400,
    "the ticked row moves on the spring",
  );
  expect(move.duration).toBe(400);
  expect(await cls(page)).toBe(0);

  // Remove: the row fades out.
  await resetRecording(page);
  await page.getByRole("button", { name: /^Remove motion bread/ }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: /motion bread/ })).toHaveCount(0);
  await expectAnimation(
    page,
    (a) => a.pseudo.startsWith("::view-transition-old(shopping-item-") && a.keyframes === "vt-fade-out",
    "a removed row fades out",
  );
  expect(await cls(page)).toBe(0);
});

test("a shopping list's title morphs from its card into the list page", async ({ page }) => {
  const name = await newListWithItems(page, "motion eggs");
  await page.getByRole("link", { name: en.shoppingList.backToAll }).click();
  await expect(page).toHaveURL(/\/dashboard\/shopping-list$/);
  const card = page.getByRole("link", { name: new RegExp(name) });
  await resetRecording(page, card);
  await card.click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expectAnimation(
    page,
    (a) => a.pseudo.startsWith("::view-transition-group(shopping-list-") && a.duration === 320,
    "the list title morphs",
  );
  // Only the title morphs: the overview's cards don't each fade out.
  expect((await recorded(page)).some((a) => a.pseudo.includes("shopping-list-card-"))).toBe(false);
});

test("an item's name morphs from the catalogue into its page", async ({ page }) => {
  await page.goto("/dashboard/inventory/items");
  const row = page.getByRole("link", { name: new RegExp(E2E_ITEM.name) }).first();
  await resetRecording(page, row);
  await row.click();
  await expect(page.getByRole("heading", { level: 1, name: E2E_ITEM.name })).toBeVisible();
  await expectAnimation(
    page,
    (a) => a.pseudo === `::view-transition-group(inventory-item-${E2E_ITEM.id})`,
    "the item name morphs",
  );
});

test("changing tab fades the new page in", async ({ page }) => {
  await page.goto("/dashboard/inventory");
  await resetRecording(page);
  // The sidebar on desktop, the bottom bar on a phone: only one is visible.
  await page.getByRole("navigation").getByRole("link", { name: en.nav.shoppingList, exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/shopping-list$/);
  await expectAnimation(
    page,
    (a) => a.pseudo.startsWith("::view-transition-new(") && a.keyframes === "vt-rise",
    "the new page rises in",
  );
});

test("with reduced motion, list changes happen at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await newListWithItems(page, "still milk");
  await expect(page.getByRole("checkbox", { name: /still milk/ })).toBeVisible();
  await expect.poll(async () => (await recorded(page)).length).toBeGreaterThan(0);
  for (const animation of await recorded(page)) {
    expect(animation.duration, animation.pseudo).toBe(0);
  }
});
