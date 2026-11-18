import { expect, test, type Page } from "@playwright/test";
import { dismissCookieNotice, gotoRevealed } from "./ui";
import { E2E_ITEM, E2E_SHOPPING_LIST } from "./seed-data";

// UX-41a: the ⌘K / Ctrl+K command palette. Open, filter, run.
const SHORTCUT = "ControlOrMeta+k";

// The shortcut listener attaches on hydration, which a press right after
// page.goto can beat. Press again only while the palette isn't up, so a slow
// hydration doesn't toggle it open and shut.
//
// Open, not just visible (MAINT-99). The palette's chunk is lazy (PERF-27),
// so it can show up between the isVisible() check and the press, and that
// press then closes it. A closing sheet stays visible while it slides out
// (about 100 ms on desktop, long enough on a phone for the arrow keys and
// a fill to pass), so toBeVisible handed back a palette that was on its
// way out, and the next thing asked of it was never there. Base UI puts
// `data-open` on the popup only while it's open and swaps it for
// `data-closed` the moment it starts to close, so a press that closed it
// fails this check and the loop opens it again.
async function openPalette(page: Page) {
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(async () => {
    if (!(await palette.isVisible())) await page.keyboard.press(SHORTCUT);
    await expect(palette).toHaveAttribute("data-open", "", { timeout: 1000 });
  }).toPass();
  return palette;
}

test("Ctrl+K opens the palette, typing filters it and Enter runs the command", async ({ page }) => {
  await gotoRevealed(page, "/dashboard");
  const palette = await openPalette(page);
  const input = palette.getByRole("combobox", { name: "Type a command" });
  await expect(input).toBeFocused();
  await expect(palette.getByRole("option", { name: "Add task" })).toBeVisible();
  await expect(palette.getByRole("option", { name: "Go to Home" })).toBeVisible();

  await input.fill("household bud");
  await expect(palette.getByRole("option")).toHaveCount(1);
  await input.press("Enter");

  await expect(page).toHaveURL(/\/dashboard\/budget$/);
  await expect(palette).toHaveCount(0);
});

test("arrow keys move the highlight and Escape closes", async ({ page }) => {
  await gotoRevealed(page, "/dashboard");
  const palette = await openPalette(page);
  const input = palette.getByRole("combobox", { name: "Type a command" });

  await expect(palette.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await input.press("ArrowDown");
  await expect(palette.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
  await input.press("ArrowUp");
  await input.press("ArrowUp");
  await expect(palette.getByRole("option").last()).toHaveAttribute("aria-selected", "true");

  await input.fill("zzzz");
  await expect(palette.getByText("No matching commands.")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
});

test("Add task opens the add-task dialog on the tasks page", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await gotoRevealed(page, "/dashboard");
  const palette = await openPalette(page);
  await palette.getByRole("combobox", { name: "Type a command" }).fill("add task");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/dashboard\/tasks$/);
  await expect(page.getByRole("textbox", { name: "Task title" })).toBeVisible();
});

// MAINT-103: the palette closes and navigates in one go. Closing takes the
// dialog's history entry back with history.back(), which only lands a few
// milliseconds later; the router pushes the new page some 100 ms after
// Enter. On a loaded machine the push can come first, and then the back
// lands on the page under the dialog's entry and one forward() from there
// reaches the closed palette's entry, still on /dashboard, not the page just
// pushed. Timing can't be asked for, so this holds the palette's back() until
// the router's next pushState and issues the two in the order a slow
// traversal gives.
test("Enter still navigates when the router pushes before the palette's history entry is gone", async ({
  page,
  context,
  baseURL,
}) => {
  await dismissCookieNotice(context, baseURL!);
  await page.addInitScript(() => {
    const { history } = window;
    const back = history.back.bind(history);
    const pushState = history.pushState.bind(history);
    const hold = window as unknown as { holdNextBack?: boolean };
    let held = false;
    history.back = () => {
      if (!hold.holdNextBack) return back();
      hold.holdNextBack = false;
      held = true;
    };
    history.pushState = (...args: Parameters<History["pushState"]>) => {
      if (held) {
        held = false;
        back();
      }
      return pushState(...args);
    };
  });
  await gotoRevealed(page, "/dashboard");
  const palette = await openPalette(page);
  await palette.getByRole("combobox", { name: "Type a command" }).fill("add task");
  await page.evaluate(() => {
    (window as unknown as { holdNextBack?: boolean }).holdNextBack = true;
  });
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/dashboard\/tasks$/);
  await expect(page.getByRole("textbox", { name: "Task title" })).toBeVisible();
});

// MAINT-113: the tasks page strips the `?add=1` it was pushed with by a
// router.replace() right after it renders. Under load that replace came
// while the repair above was still stepping forward, with the browser on
// /dashboard: it rewrote that entry, the repair went on to the `?add=1`
// one, and the router restored it. Same hold as above, plus the repair's
// first forward() is held until the router's replace has been issued, which
// is the order the loaded run took.
test("Enter still lands on the stripped URL when the page replaces it during the repair", async ({
  page,
  context,
  baseURL,
}) => {
  await dismissCookieNotice(context, baseURL!);
  type Holds = { holdNextBack?: boolean; holdNextForward?: boolean; holdNextReplace?: boolean; release?: () => void };
  await page.addInitScript(() => {
    const { history } = window;
    const back = history.back.bind(history);
    const forward = history.forward.bind(history);
    const pushState = history.pushState.bind(history);
    const hold = window as unknown as Holds;
    let heldBack = false;
    let heldForward = false;
    let heldReplace: (() => void) | null = null;
    // Lets whichever of the forward and the replace comes second go: the
    // replace first, then the forward.
    hold.release = () => {
      if (!heldForward || heldReplace === null) return;
      heldReplace();
      heldReplace = null;
      heldForward = false;
      forward();
    };
    history.back = () => {
      if (!hold.holdNextBack) return back();
      hold.holdNextBack = false;
      heldBack = true;
    };
    history.forward = () => {
      if (!hold.holdNextForward) return forward();
      hold.holdNextForward = false;
      heldForward = true;
      hold.release!();
    };
    history.pushState = (...args: Parameters<History["pushState"]>) => {
      if (heldBack) {
        heldBack = false;
        back();
      }
      return pushState(...args);
    };
    // Called from the outermost replaceState, wrapped after hydration.
    (hold as unknown as { holdReplace: (go: () => void) => void }).holdReplace = (go) => {
      heldReplace = go;
      hold.release!();
    };
  });
  await gotoRevealed(page, "/dashboard");
  // The router patches replaceState on hydration, so this wraps it from
  // outside and sees the router's own call, before any patch under it.
  await page.evaluate(() => {
    const { history } = window;
    const replaceState = history.replaceState.bind(history);
    const hold = window as unknown as Holds & { holdReplace: (go: () => void) => void };
    history.replaceState = (...args: Parameters<History["replaceState"]>) => {
      const [, , url] = args;
      if (hold.holdNextReplace && url != null && new URL(url, location.href).href.endsWith("/dashboard/tasks")) {
        hold.holdNextReplace = false;
        hold.holdReplace(() => replaceState(...args));
        return;
      }
      return replaceState(...args);
    };
  });
  const palette = await openPalette(page);
  await palette.getByRole("combobox", { name: "Type a command" }).fill("add task");
  await page.evaluate(() => {
    Object.assign(window, { holdNextBack: true, holdNextForward: true, holdNextReplace: true });
  });
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/dashboard\/tasks$/);
  await expect(page.getByRole("textbox", { name: "Task title" })).toBeVisible();
  // And Back from the add dialog leaves the URL as it is.
  await page.goBack();
  await expect(page.getByRole("textbox", { name: "Task title" })).toHaveCount(0);
  await expect(page).toHaveURL(/\/dashboard\/tasks$/);
});

// MAINT-118: the tasks page's router.replace() only writes the stripped URL
// once the server has answered it. Under load the repair's last step landed
// while that request was still out, and the router, handed that popstate,
// restored the `?add=1` entry it was already on, which throws away the
// navigation in flight: the page stayed on `?add=1`. Same hold as the
// MAINT-103 test, plus the repair's last forward() is held until the strip's
// request has gone out, and that request is slowed so it's still out when
// the forward lands.
test("Enter still lands on the stripped URL when the repair lands while the strip is in flight", async ({
  page,
  context,
  baseURL,
}) => {
  await dismissCookieNotice(context, baseURL!);
  // The strip: the router's request for the tasks page without `?add=1` (a
  // navigation's, not a prefetch's).
  await page.route("**/dashboard/tasks?*", async (route) => {
    const headers = route.request().headers();
    const url = new URL(route.request().url());
    if (!url.searchParams.has("add") && "rsc" in headers && !("next-router-prefetch" in headers)) {
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    await route.continue();
  });
  await page.addInitScript(() => {
    const { history } = window;
    const back = history.back.bind(history);
    const forward = history.forward.bind(history);
    const pushState = history.pushState.bind(history);
    const fetch = window.fetch.bind(window);
    const hold = window as unknown as { holdNextBack?: boolean; forwardsToHold?: number };
    let heldBack = false;
    let heldForward = false;
    let stripSent = false;
    history.back = () => {
      if (!hold.holdNextBack) return back();
      hold.holdNextBack = false;
      heldBack = true;
    };
    // The repair's second forward() is its last: that one waits for the strip.
    history.forward = () => {
      if (hold.forwardsToHold === undefined || --hold.forwardsToHold > 0 || stripSent) return forward();
      hold.forwardsToHold = undefined;
      heldForward = true;
    };
    history.pushState = (...args: Parameters<History["pushState"]>) => {
      if (heldBack) {
        heldBack = false;
        back();
      }
      return pushState(...args);
    };
    window.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const strip = url.pathname === "/dashboard/tasks" && !url.searchParams.has("add");
      if (strip && headers.has("rsc") && !headers.has("next-router-prefetch")) {
        stripSent = true;
        if (heldForward) {
          heldForward = false;
          forward();
        }
      }
      return fetch(input, init);
    };
  });
  await gotoRevealed(page, "/dashboard");
  const palette = await openPalette(page);
  await palette.getByRole("combobox", { name: "Type a command" }).fill("add task");
  await page.evaluate(() => {
    Object.assign(window, { holdNextBack: true, forwardsToHold: 2 });
  });
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/dashboard\/tasks$/);
  await expect(page.getByRole("textbox", { name: "Task title" })).toBeVisible();
});

test("Add to shopping list focuses the add box of the list in use", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await gotoRevealed(page, "/dashboard");
  const palette = await openPalette(page);
  await palette.getByRole("combobox", { name: "Type a command" }).fill("shopping list");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/dashboard\/shopping-list\/[^/?]+$/);
  await expect(page.getByRole("combobox", { name: "Add to the list" })).toBeFocused();
});

// UX-41b: household search. The seeded household has an inventory item and a
// shopping list, which also proves the results are this household's own.
test("typing searches the household and Enter opens the row", async ({ page }) => {
  await gotoRevealed(page, "/dashboard");
  const palette = await openPalette(page);
  const input = palette.getByRole("combobox", { name: "Type a command" });

  await input.fill(E2E_ITEM.name);
  await expect(palette.getByRole("option", { name: E2E_ITEM.name })).toBeVisible();
  await expect(palette.getByText("Inventory", { exact: true }).first()).toBeVisible();
  await expect(palette.getByRole("option")).toHaveCount(1);
  await input.press("Enter");

  await expect(page).toHaveURL(new RegExp(`/dashboard/inventory/items/${E2E_ITEM.id}$`));
});

test("a shopping list is found by name and a miss shows the empty state", async ({ page }) => {
  await gotoRevealed(page, "/dashboard");
  const palette = await openPalette(page);
  const input = palette.getByRole("combobox", { name: "Type a command" });

  await input.fill(E2E_SHOPPING_LIST.name.toLowerCase());
  await expect(palette.getByRole("option", { name: E2E_SHOPPING_LIST.name })).toBeVisible();
  await expect(palette.getByText("Shopping lists", { exact: true }).first()).toBeVisible();

  await input.fill("zzzzqq");
  await expect(palette.getByText("No matching commands.")).toBeVisible();
  await expect(palette.getByRole("option")).toHaveCount(0);

  await input.fill(E2E_SHOPPING_LIST.name);
  await palette.getByRole("option", { name: E2E_SHOPPING_LIST.name }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/shopping-list/${E2E_SHOPPING_LIST.id}$`));
});
