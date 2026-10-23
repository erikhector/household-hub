import { expect, test, type Locator, type Page } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { E2E_ITEM } from "./seed-data";
import { clickRowAction, dismissCookieNotice, holdServerActions } from "./ui";

// UX-33: the motion system. Two kinds of motion, two recorders:
//
// - List rows move at tap time and glide there with the Web Animations API
//   (use-flip-list.ts). An init script wraps Element.prototype.animate and
//   notes each "flip-*" animation and the row it ran on.
// - Navigations (the tab fade, the title morphs) are view transitions, whose
//   animations run on pseudo-elements no locator can reach. The script also
//   wraps document.startViewTransition and, once each one is ready, notes
//   every running view-transition animation (pseudo-element, keyframes,
//   duration).
//
// Layout shifts are collected the way cls.spec.ts does: every shift except
// those in the 500 ms after a tap or key, which is what CLS counts.
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

type VtAnimation = { pseudo: string; keyframes: string; duration: number };
type Flip = { id: string; key: string };
type Recorder = { __vt: VtAnimation[][]; __flips: Flip[]; __cls: number; __shifted: string[]; __skipped: number };

test.beforeEach(async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await page.addInitScript(() => {
    const w = window as unknown as Recorder;
    w.__vt = [];
    w.__flips = [];
    w.__cls = 0;
    w.__shifted = [];
    w.__skipped = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as {
        value: number;
        hadRecentInput: boolean;
        sources: { node?: Node }[];
      }[]) {
        if (entry.hadRecentInput) continue;
        w.__cls += entry.value;
        // What moved, for the failure message.
        for (const source of entry.sources) {
          w.__shifted.push((source.node as Element | undefined)?.outerHTML?.slice(0, 160) ?? String(source.node?.nodeName));
        }
      }
    }).observe({ type: "layout-shift", buffered: true });

    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, ...args: Parameters<typeof animate>) {
      const options = args[1];
      if (typeof options === "object" && options.id?.startsWith("flip-")) {
        w.__flips.push({ id: options.id, key: (this as HTMLElement).dataset.flipKey ?? "" });
      }
      return animate.apply(this, args);
    };

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
        // Skipped: React skips one when an urgent update lands before the
        // snapshot. Nothing ran; counted for the failure message.
        () => {
          w.__skipped += 1;
        },
      );
      return transition;
    };
  });
});

async function flips(page: Page) {
  return page.evaluate(() => (window as unknown as Recorder).__flips);
}

async function recorded(page: Page) {
  return page.evaluate(() => (window as unknown as { __vt: VtAnimation[][] }).__vt.flat());
}

// Starts a fresh recording once the page has settled. A navigation tapped
// while the page is still hydrating commits without a view transition, so
// a click straight after goto() would test nothing a person does.
async function resetRecording(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => {
    const w = window as unknown as Recorder;
    w.__vt = [];
    w.__flips = [];
    w.__cls = 0;
    w.__shifted = [];
    w.__skipped = 0;
  });
}

async function expectNoLayoutShift(page: Page) {
  const { cls, shifted } = await page.evaluate(() => {
    const w = window as unknown as { __cls: number; __shifted: string[] };
    return { cls: w.__cls, shifted: w.__shifted };
  });
  expect(cls, `layout shift outside the 500 ms after input; moved: ${shifted.join(" | ")}`).toBe(0);
}

/**
 * Clicks a link and expects the navigation to animate. React starts a view
 * transition only when the commit holds nothing but the navigation; on a
 * busy machine an unrelated update elsewhere on the page sometimes lands
 * in the same render, and the page then just swaps (correctly, without the
 * animation). So a navigation that didn't animate is retried from where it
 * started, up to three times: what's under test is that it's wired to
 * animate, not React's scheduling.
 */
async function expectNavigationAnimates(
  page: Page,
  link: () => Locator,
  arrived: () => Promise<void>,
  match: (animation: VtAnimation) => boolean,
  what: string,
) {
  const from = page.url();
  for (let attempt = 1; ; attempt++) {
    await link().scrollIntoViewIfNeeded();
    await resetRecording(page);
    await link().click();
    await arrived();
    const animated = await expect
      .poll(async () => (await recorded(page)).some(match), { timeout: 3000 })
      .toBe(true)
      .then(
        () => true,
        () => false,
      );
    if (animated) return;
    if (attempt === 3) {
      const skipped = await page.evaluate(() => (window as unknown as { __skipped: number }).__skipped);
      expect(animated, `${what}, on any of 3 tries (skipped on the last: ${skipped})`).toBe(true);
    }
    await page.goto(from);
  }
}

async function newListWithItems(page: Page, items: string) {
  const name = unique("Motion shop");
  await page.goto("/dashboard/shopping-list");
  await page.getByRole("button", { name: "New list" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await page.getByRole("button", { name: "Create list" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await resetRecording(page);
  await addToList(page, items);
  return name;
}

async function addToList(page: Page, items: string) {
  const addBox = page.getByRole("combobox", { name: "Add to the list" });
  await addBox.fill(items);
  await addBox.press("Enter");
}

// The acceptance: add, tick and delete animate, with no layout shift. Every
// save is held at the server for longer than the browser's 500 ms grace, so
// a row that waited for the server to move would count as a shift. The
// names match no category, so every row lands in "Other", the last section.
test("adding, ticking and removing shopping items glide, with no layout shift", async ({ page }) => {
  // "motion yak" is never ticked, so the list doesn't swap to its
  // all-cleared state (which hides the rows) at the end.
  await newListWithItems(page, "motion qux, motion zap, motion yak");
  await expect(page.getByRole("checkbox", { name: /motion yak/ })).toBeVisible();
  const path = new URL(page.url()).pathname;

  // Add: the new row rises in when the server has made it. Nothing sits
  // below the end of the last section yet, so nothing else moves.
  await resetRecording(page);
  await addToList(page, "motion vim");
  await expect(page.getByRole("checkbox", { name: /motion vim/ })).toBeVisible();
  await expect.poll(async () => (await flips(page)).map((flip) => flip.id)).toContain("flip-enter");
  await expectNoLayoutShift(page);

  // Tick: before the save is even sent on, the row drops out of its aisle
  // into the collapsed "In the cart" (UX-37's own animation), and the rows
  // below glide up into its place. The one that slid up takes a tap while
  // it's still moving.
  await resetRecording(page);
  const held = await holdServerActions(page, path);
  const zapKey = await page
    .getByRole("checkbox", { name: /motion zap/ })
    .locator("xpath=ancestor::*[@data-swipe-row]")
    .getAttribute("data-flip-key");
  await page.getByRole("checkbox", { name: /motion qux/ }).click();
  const cart = page.getByRole("button", { name: new RegExp(`^${en.shoppingList.shoppingMode.inCart}`) });
  await expect(cart).toContainText("1");
  await expect(page.getByRole("checkbox", { name: /motion qux/ })).toHaveCount(0);
  await expect
    .poll(async () => (await flips(page)).filter((flip) => flip.id === "flip-move").map((flip) => flip.key))
    .toContain(zapKey);
  await page.getByRole("checkbox", { name: /motion zap/ }).click();
  await expect(cart).toContainText("2");
  await page.waitForTimeout(800);
  expect(held.answered()).toBe(0);
  held.release();
  await expect.poll(held.answered).toBe(2);
  await page.waitForLoadState("networkidle");
  await expectNoLayoutShift(page);

  // Remove: the row is gone at tap time and fades out where it was.
  await resetRecording(page);
  const heldDelete = await holdServerActions(page, path);
  await clickRowAction(page, { button: "Remove motion vim", menu: "More actions for motion vim", item: "Delete" });
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: /motion vim/ })).toHaveCount(0);
  expect((await flips(page)).map((flip) => flip.id)).toContain("flip-exit");
  await page.waitForTimeout(800);
  expect(heldDelete.answered()).toBe(0);
  heldDelete.release();
  await expect.poll(heldDelete.answered).toBe(1);
  await page.waitForLoadState("networkidle");
  await expectNoLayoutShift(page);

  // And it all saved.
  await page.reload();
  await cart.click();
  await expect(page.getByRole("checkbox", { name: /motion qux/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /motion vim/ })).toHaveCount(0);
});

test("a completed task moves to Completed at tap time", async ({ page }) => {
  const title = unique("Motion chore");
  await page.goto("/dashboard/tasks");
  await page.getByRole("button", { name: "Add task" }).click();
  await page.getByRole("textbox", { name: "Task title" }).fill(title);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const box = page.getByRole("checkbox", { name: `Mark ${title} as done` });
  await expect(box).toBeVisible();

  await resetRecording(page);
  const held = await holdServerActions(page, "/dashboard/tasks");
  await box.click();
  await expect(page.getByRole("checkbox", { name: `Mark ${title} as not done` })).toBeChecked();
  await expect(page.getByRole("main").getByText(en.tasks.completedSectionLabel, { exact: true })).toBeVisible();
  expect(held.answered()).toBe(0);
  held.release();
  await expect.poll(held.answered).toBe(1);
  await page.waitForLoadState("networkidle");
  await expectNoLayoutShift(page);
});

test("a shopping list's title morphs from its card into the list page", async ({ page }) => {
  const name = await newListWithItems(page, "motion eggs");
  await page.getByRole("link", { name: en.shoppingList.backToAll }).click();
  await expect(page).toHaveURL(/\/dashboard\/shopping-list$/);
  await expectNavigationAnimates(
    page,
    () => page.getByRole("link", { name: new RegExp(name) }),
    () => expect(page.getByRole("heading", { level: 1, name })).toBeVisible(),
    (a) => a.pseudo.startsWith("::view-transition-group(shopping-list-") && a.duration === 320,
    "the list title morphs",
  );
});

test("an item's name morphs from the catalogue into its page", async ({ page }) => {
  await page.goto("/dashboard/inventory/items");
  await expectNavigationAnimates(
    page,
    () => page.getByRole("link", { name: new RegExp(E2E_ITEM.name) }).first(),
    () => expect(page.getByRole("heading", { level: 1, name: E2E_ITEM.name })).toBeVisible(),
    (a) => a.pseudo === `::view-transition-group(inventory-item-${E2E_ITEM.id})`,
    "the item name morphs",
  );
});

test("changing tab fades the new page in", async ({ page }) => {
  await page.goto("/dashboard/inventory");
  await expectNavigationAnimates(
    page,
    // The sidebar on desktop, the bottom bar on a phone: only one is visible.
    () => page.getByRole("navigation").getByRole("link", { name: en.nav.shoppingList, exact: true }),
    () => expect(page).toHaveURL(/\/dashboard\/shopping-list$/),
    (a) => a.pseudo.startsWith("::view-transition-new(") && a.keyframes === "vt-rise",
    "the new page rises in",
  );
});

test("with reduced motion, list changes happen at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await newListWithItems(page, "still milk, still tea");
  await expect(page.getByRole("checkbox", { name: /still tea/ })).toBeVisible();
  await page.getByRole("checkbox", { name: /still milk/ }).click();
  await expect(page.getByRole("button", { name: new RegExp(`^${en.shoppingList.shoppingMode.inCart}`) })).toContainText("1");
  expect(await flips(page)).toEqual([]);
  // And a navigation's view transition (the tab fade) takes no time.
  await page.getByRole("navigation").getByRole("link", { name: en.nav.inventory, exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/inventory$/);
  for (const animation of await recorded(page)) {
    expect(animation.duration, animation.pseudo).toBe(0);
  }
});
