import { expect, test, type Locator, type Page } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { E2E_ITEM } from "./seed-data";
import { dismissCookieNotice } from "./ui";

// UX-33: the motion system. React's <ViewTransition> drives the browser's
// View Transitions API, whose animations run on pseudo-elements that no
// locator can reach, so each test records them instead: an init script
// wraps document.startViewTransition and, once each transition is ready,
// notes every running view-transition animation (which pseudo-element,
// which keyframes, how long).
//
// Layout shifts are collected the way cls.spec.ts does (ignoring the 500
// ms after a tap or key), minus shifts of an element the view transition
// was animating at the time. A row only moves once the server has answered
// (UX-14), and when that takes over 500 ms (a loaded CI box, a phone in a
// shop) the browser's metric counts the move even though what's on screen
// is the row gliding there. What this guards is the jump: anything that
// moved without being animated.
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

type VtAnimation = { pseudo: string; keyframes: string; duration: number };

test.beforeEach(async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await page.addInitScript(() => {
    const w = window as unknown as { __vt: VtAnimation[][]; __cls: number; __shifted: string[]; __skipped: number };
    w.__vt = [];
    w.__cls = 0;
    w.__shifted = [];
    w.__skipped = 0;
    // Elements a transition animated (React sets their view-transition-name
    // inline for the transition's length), with when it ran.
    const animated = new WeakMap<Element, { from: number; to: number }[]>();
    const wasAnimated = (node: Node | undefined, at: number) => {
      for (let el = node instanceof Element ? node : node?.parentElement; el; el = el.parentElement) {
        if (animated.get(el)?.some((span) => at >= span.from - 50 && at <= span.to + 50)) return true;
      }
      return false;
    };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as {
        value: number;
        startTime: number;
        hadRecentInput: boolean;
        sources: { node?: Node }[];
      }[]) {
        if (entry.hadRecentInput) continue;
        if (entry.sources.length > 0 && entry.sources.every((source) => wasAnimated(source.node, entry.startTime))) continue;
        w.__cls += entry.value;
        // What moved, for the failure message.
        for (const source of entry.sources) {
          w.__shifted.push((source.node as Element | undefined)?.outerHTML?.slice(0, 160) ?? String(source.node?.nodeName));
        }
      }
    }).observe({ type: "layout-shift", buffered: true });

    const start = Document.prototype.startViewTransition;
    if (!start) return;
    Document.prototype.startViewTransition = function (this: Document, ...args: Parameters<typeof start>) {
      const transition = start.apply(this, args);
      const span = { from: performance.now(), to: Infinity };
      transition.ready.then(() => {
        for (const el of document.querySelectorAll<HTMLElement>("[style*='view-transition-name']")) {
          if (el.style.viewTransitionName && el.style.viewTransitionName !== "none") {
            animated.set(el, [...(animated.get(el) ?? []), span]);
          }
        }
      }, () => {});
      transition.finished.finally(() => {
        span.to = performance.now();
      });
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

async function recorded(page: Page) {
  return page.evaluate(() => (window as unknown as { __vt: VtAnimation[][] }).__vt.flat());
}

// Starts a fresh recording once the page has settled. A navigation tapped
// while the page is still hydrating commits without a view transition, so
// a click straight after goto() would test nothing a person does.
async function resetRecording(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => {
    const w = window as unknown as { __vt: VtAnimation[][]; __cls: number; __shifted: string[]; __skipped: number };
    w.__vt = [];
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
  expect(cls, `unanimated layout shift outside the 500 ms after input; moved: ${shifted.join(" | ")}`).toBe(0);
}

/** Waits until a recorded animation matches, then returns it. */
async function expectAnimation(page: Page, match: (animation: VtAnimation) => boolean, what: string) {
  const seen = await expect
    .poll(async () => (await recorded(page)).some(match))
    .toBe(true)
    .then(
      () => true,
      () => false,
    );
  const skipped = await page.evaluate(() => (window as unknown as { __skipped: number }).__skipped);
  expect(seen, `${what} (view transitions skipped meanwhile: ${skipped})`).toBe(true);
  return (await recorded(page)).find(match)!;
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

// The acceptance is about the list's own interactions, so the list already
// has rows when measuring starts: a brand-new list's first add also brings
// in the page's list toolbar, which is a different change. The names match
// no category, so every row lands in "Other", the last section.
test("adding, ticking and removing shopping items animate without shifting the layout", async ({ page }) => {
  await newListWithItems(page, "motion qux, motion zap");
  await expect(page.getByRole("checkbox", { name: /motion zap/ })).toBeVisible();
  // Add: the new row rises in.
  await resetRecording(page);
  await addToList(page, "motion vim");
  await expect(page.getByRole("checkbox", { name: /motion vim/ })).toBeVisible();
  await expectAnimation(
    page,
    (a) => a.pseudo.startsWith("::view-transition-new(shopping-item-") && a.keyframes === "vt-fade-in",
    "an added row fades in",
  );
  await expectNoLayoutShift(page);

  // Tick: once the save lands, the row travels to "Purchased" on the
  // spring (a paired move, not a delete and an add), and the rows below
  // glide up into its place.
  await resetRecording(page);
  await page.getByRole("checkbox", { name: /motion qux/ }).click();
  const purchased = page.getByRole("main").getByText(en.shoppingList.purchased, { exact: true });
  await expect(purchased).toBeVisible();
  await expectAnimation(
    page,
    (a) => a.pseudo.startsWith("::view-transition-group(shopping-item-") && a.duration === 400,
    "the ticked row moves on the spring",
  );
  await expectNoLayoutShift(page);

  // Remove: the row fades out and what's below it closes the gap.
  await resetRecording(page);
  await page.getByRole("button", { name: /^Remove motion zap/ }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: /motion zap/ })).toHaveCount(0);
  await expectAnimation(
    page,
    (a) => a.pseudo.startsWith("::view-transition-old(shopping-item-") && a.keyframes === "vt-fade-out",
    "a removed row fades out",
  );
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
  // Only the title morphs: the overview's cards don't each fade out.
  expect((await recorded(page)).some((a) => a.pseudo.includes("shopping-list-card-"))).toBe(false);
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
  await newListWithItems(page, "still milk");
  await expect(page.getByRole("checkbox", { name: /still milk/ })).toBeVisible();
  await expect.poll(async () => (await recorded(page)).length).toBeGreaterThan(0);
  for (const animation of await recorded(page)) {
    expect(animation.duration, animation.pseudo).toBe(0);
  }
});
