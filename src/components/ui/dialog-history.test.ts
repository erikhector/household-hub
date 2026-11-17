// UX-11: a fake window/history (vitest runs in node), so the stack logic in
// dialog-history.ts is checked without a browser. The real back gesture is
// covered end to end in e2e/back-closes-dialogs.spec.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (event: PopStateEvent) => void;

function fakeBrowser(href = "https://app.test/dashboard/inventory") {
  const entries: { state: unknown; href: string }[] = [{ state: { __NA: true }, href }];
  let index = 0;
  let listener: Listener | null = null;
  const location = { href };
  const history = {
    get state() {
      return entries[index].state;
    },
    pushState(state: unknown) {
      entries.splice(index + 1, entries.length, { state, href: location.href });
      index += 1;
    },
    replaceState(state: unknown, _unused: string, url?: string) {
      if (url) location.href = url;
      entries[index] = { state, href: location.href };
    },
    back() {
      index -= 1;
      location.href = entries[index].href;
    },
    forward() {
      index += 1;
      location.href = entries[index].href;
    },
  };
  vi.stubGlobal("window", {
    location,
    history,
    addEventListener: (_type: string, handler: Listener) => {
      listener = handler;
    },
  });
  return {
    entries: () => entries.length,
    hrefs: () => entries.map((entry) => entry.href),
    index: () => index,
    // What the browser does on a back gesture or after history.back(): move,
    // then fire popstate with the landed entry's state.
    pop() {
      const event = { state: history.state, stopImmediatePropagation: vi.fn() };
      listener?.(event as unknown as PopStateEvent);
      return event.stopImmediatePropagation;
    },
    back() {
      history.back();
      return this.pop();
    },
    // The app navigating to another page on top of the dialog's entry.
    navigate(to: string) {
      location.href = to;
      history.pushState({ __NA: true });
    },
  };
}

// The module keeps its stack and listener across calls, so each test gets
// a fresh copy against its own fake browser.
async function load() {
  vi.resetModules();
  return import("./dialog-history");
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("pushDialogEntry", () => {
  it("closes the dialog on back, and keeps the router from seeing the same-URL pop", async () => {
    const browser = fakeBrowser();
    const { pushDialogEntry } = await load();
    const close = vi.fn();
    pushDialogEntry(close);
    expect(browser.index()).toBe(1);

    const stopped = browser.back();

    expect(close).toHaveBeenCalledOnce();
    expect(stopped).toHaveBeenCalled();
  });

  it("removes its entry when closed from the UI, without closing again", async () => {
    const browser = fakeBrowser();
    const { pushDialogEntry } = await load();
    const close = vi.fn();
    const release = pushDialogEntry(close);
    const back = vi.spyOn(window.history, "back");

    release();
    expect(back).toHaveBeenCalledOnce();
    // Our own back() lands on the page itself: swallowed, nothing closes.
    expect(browser.index()).toBe(0);
    expect(browser.pop()).toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("does nothing on release after the back gesture already closed it", async () => {
    const browser = fakeBrowser();
    const { pushDialogEntry } = await load();
    const release = pushDialogEntry(vi.fn());
    browser.back();
    const back = vi.spyOn(window.history, "back");

    release();
    expect(back).not.toHaveBeenCalled();
  });

  it("closes only the top dialog of a nested pair", async () => {
    const browser = fakeBrowser();
    const { pushDialogEntry } = await load();
    const outer = vi.fn();
    const inner = vi.fn();
    pushDialogEntry(outer);
    pushDialogEntry(inner);

    browser.back();
    expect(inner).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();

    browser.back();
    expect(outer).toHaveBeenCalledOnce();
  });

  it("doesn't go back when the app navigated on top of the dialog's entry", async () => {
    const browser = fakeBrowser();
    const { pushDialogEntry } = await load();
    const release = pushDialogEntry(vi.fn());
    browser.navigate("https://app.test/dashboard/inventory/items/kept");
    const back = vi.spyOn(window.history, "back");

    release();
    expect(back).not.toHaveBeenCalled();
  });

  it("steps forward again when the app replaced the URL before our back() landed", async () => {
    const browser = fakeBrowser("https://app.test/dashboard/inventory/items/merged");
    const { pushDialogEntry } = await load();
    const release = pushDialogEntry(vi.fn());
    // history.back() is async: it lands only after the merge dialog's
    // router.replace has already rewritten the (still current) entry.
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    release();
    expect(back).toHaveBeenCalledOnce();
    window.history.replaceState({ __NA: true }, "", "https://app.test/dashboard/inventory/items/kept");
    back.mockRestore();
    const forward = vi.spyOn(window.history, "forward");

    const stopped = browser.back();

    expect(stopped).toHaveBeenCalled();
    expect(forward).toHaveBeenCalledOnce();
    expect(window.location.href).toBe("https://app.test/dashboard/inventory/items/kept");
  });

  // MAINT-103: the command palette closes and router.push()es in one go. A
  // push that beats the palette's back() leaves the closed palette's entry
  // between the page and the new one, so one forward() only reached that
  // entry, on the old URL, and the navigation was lost.
  it("steps forward twice when the app pushed a page before our back() landed", async () => {
    const browser = fakeBrowser("https://app.test/dashboard");
    const { pushDialogEntry } = await load();
    const close = vi.fn();
    const release = pushDialogEntry(close);
    const realBack = window.history.back.bind(window.history);
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    release();
    expect(back).toHaveBeenCalledOnce();
    browser.navigate("https://app.test/dashboard/tasks?add=1");
    back.mockRestore();
    const forward = vi.spyOn(window.history, "forward");

    // The browser takes the back from the dialog's entry, where history
    // stood when it was called: it lands on the page under it.
    realBack();
    realBack();
    expect(browser.index()).toBe(0);
    // Both the back and the forward onto the closed dialog's entry are
    // kept from the router, and each is followed by a forward.
    expect(browser.pop()).toHaveBeenCalled();
    expect(browser.index()).toBe(1);
    expect(browser.pop()).toHaveBeenCalled();
    expect(browser.index()).toBe(2);
    // The last one lands on the page the app went to: the router's.
    expect(browser.pop()).not.toHaveBeenCalled();

    expect(forward).toHaveBeenCalledTimes(2);
    expect(window.location.href).toBe("https://app.test/dashboard/tasks?add=1");
    expect(close).not.toHaveBeenCalled();
  });

  // MAINT-113: the page the palette pushed rewrites its own URL straight
  // away (the tasks page strips `?add=1` with router.replace). When that
  // replace comes while the repair is still stepping forward, the browser is
  // on an entry the router has left: the replace rewrote that one, and the
  // repair then landed on the stale `?add=1` entry, which the router
  // restored. The replace waits for the repair and is applied where it lands.
  it("holds the app's history writes until the repair has landed, then applies them there", async () => {
    const browser = fakeBrowser("https://app.test/dashboard");
    const { pushDialogEntry } = await load();
    const release = pushDialogEntry(vi.fn());
    const realBack = window.history.back.bind(window.history);
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    release();
    browser.navigate("https://app.test/dashboard/tasks?add=1");
    back.mockRestore();
    realBack();
    realBack();
    expect(browser.index()).toBe(0);

    // The back has landed under the palette's entry; the replace comes now.
    window.history.replaceState({ __NA: true }, "", "https://app.test/dashboard/tasks");
    expect(browser.hrefs()).toEqual([
      "https://app.test/dashboard",
      "https://app.test/dashboard",
      "https://app.test/dashboard/tasks?add=1",
    ]);

    expect(browser.pop()).toHaveBeenCalled();
    expect(browser.pop()).toHaveBeenCalled();
    expect(browser.index()).toBe(2);
    // The last step lands where the router is, with its replace applied, so
    // there's nothing for the router to restore (its tree is `?add=1`'s).
    expect(browser.pop()).toHaveBeenCalled();

    expect(window.location.href).toBe("https://app.test/dashboard/tasks");
    expect(browser.hrefs()).toEqual([
      "https://app.test/dashboard",
      "https://app.test/dashboard",
      "https://app.test/dashboard/tasks",
    ]);
    // Settled: writes go straight through again.
    window.history.replaceState({ __NA: true }, "", "https://app.test/dashboard/tasks?view=all");
    expect(window.location.href).toBe("https://app.test/dashboard/tasks?view=all");
  });

  // The safety valve: if the repair's popstate never comes (a forward() that
  // finds no entry, or a pop another listener stopped first), the held writes
  // must not wait for the rest of the session with the URL frozen.
  it("applies the held writes where the browser is when the repair's popstate never arrives", async () => {
    vi.useFakeTimers();
    try {
      const browser = fakeBrowser("https://app.test/dashboard");
      const { pushDialogEntry } = await load();
      const release = pushDialogEntry(vi.fn());
      const realBack = window.history.back.bind(window.history);
      const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
      release();
      browser.navigate("https://app.test/dashboard/tasks?add=1");
      back.mockRestore();
      realBack();
      realBack();
      // Our back() lands: the repair steps forward, but that step's popstate
      // is lost.
      expect(browser.pop()).toHaveBeenCalled();
      window.history.replaceState({ __NA: true }, "", "https://app.test/dashboard/tasks");
      expect(window.location.href).not.toBe("https://app.test/dashboard/tasks");

      vi.advanceTimersByTime(999);
      expect(window.location.href).not.toBe("https://app.test/dashboard/tasks");
      vi.advanceTimersByTime(1);
      expect(window.location.href).toBe("https://app.test/dashboard/tasks");

      // Released: later writes go straight through, and a dialog pushes its
      // entry at once.
      window.history.replaceState({ __NA: true }, "", "https://app.test/dashboard/tasks?view=all");
      expect(window.location.href).toBe("https://app.test/dashboard/tasks?view=all");
      const index = browser.index();
      pushDialogEntry(vi.fn());
      expect(browser.index()).toBe(index + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps holding the writes while the repair's popstates keep arriving", async () => {
    vi.useFakeTimers();
    try {
      const browser = fakeBrowser("https://app.test/dashboard");
      const { pushDialogEntry } = await load();
      const release = pushDialogEntry(vi.fn());
      const realBack = window.history.back.bind(window.history);
      const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
      release();
      browser.navigate("https://app.test/dashboard/tasks?add=1");
      back.mockRestore();
      realBack();
      realBack();
      window.history.replaceState({ __NA: true }, "", "https://app.test/dashboard/tasks");

      // Each step comes 600 ms after the last: slow, but within the valve's
      // window every time, so the writes stay held for the landing entry.
      vi.advanceTimersByTime(600);
      browser.pop();
      vi.advanceTimersByTime(600);
      browser.pop();
      vi.advanceTimersByTime(600);
      expect(browser.index()).toBe(2);
      expect(window.location.href).toBe("https://app.test/dashboard/tasks?add=1");
      browser.pop();
      expect(window.location.href).toBe("https://app.test/dashboard/tasks");
      expect(browser.hrefs()).toEqual([
        "https://app.test/dashboard",
        "https://app.test/dashboard",
        "https://app.test/dashboard/tasks",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds a new dialog's entry until the repairing forward has landed", async () => {
    const browser = fakeBrowser("https://app.test/dashboard/inventory/items/merged");
    const { pushDialogEntry } = await load();
    const release = pushDialogEntry(vi.fn());
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    release();
    window.history.replaceState({ __NA: true }, "", "https://app.test/dashboard/inventory/items/kept");
    back.mockRestore();
    browser.back();
    expect(browser.index()).toBe(1);

    // The forward is on its way; a push now would cut it short.
    pushDialogEntry(vi.fn());
    expect(browser.entries()).toBe(2);
    browser.pop();
    expect(browser.entries()).toBe(3);
    expect(browser.index()).toBe(2);
  });

  // MAINT-23: a sheet hands over to a confirm in one render, so the confirm
  // asks to push while the sheet's back() is still on its way. Pushing then
  // made the back land below both entries, and the repairing forward() popped
  // the confirm.
  it("waits for a pending back() to land before a new dialog pushes its entry", async () => {
    const browser = fakeBrowser();
    const { pushDialogEntry } = await load();
    const releaseSheet = pushDialogEntry(vi.fn());
    const realBack = window.history.back.bind(window.history);
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    releaseSheet();
    const forward = vi.spyOn(window.history, "forward");
    const closeConfirm = vi.fn();

    pushDialogEntry(closeConfirm);
    expect(browser.entries()).toBe(2);

    realBack();
    browser.pop();
    expect(back).toHaveBeenCalledOnce();
    expect(forward).not.toHaveBeenCalled();
    expect(browser.index()).toBe(1);
    expect(closeConfirm).not.toHaveBeenCalled();

    // The confirm owns the entry now: back closes it.
    back.mockRestore();
    browser.back();
    expect(closeConfirm).toHaveBeenCalledOnce();
  });

  it("never pushes an entry for a dialog closed while it was waiting", async () => {
    const browser = fakeBrowser();
    const { pushDialogEntry } = await load();
    const releaseSheet = pushDialogEntry(vi.fn());
    const realBack = window.history.back.bind(window.history);
    vi.spyOn(window.history, "back").mockImplementation(() => {});
    releaseSheet();
    const releaseConfirm = pushDialogEntry(vi.fn());
    releaseConfirm();

    realBack();
    browser.pop();
    expect(browser.entries()).toBe(2);
    expect(browser.index()).toBe(0);
  });

  it("keeps its marker through the router's same-URL state replaces", async () => {
    const browser = fakeBrowser();
    const { pushDialogEntry } = await load();
    const close = vi.fn();
    const release = pushDialogEntry(close);
    // Next.js rewrites the current entry's state on every commit.
    window.history.replaceState({ __NA: true }, "", window.location.href);
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});

    release();
    expect(back).toHaveBeenCalledOnce();
    // And another one while our back() is on its way isn't mistaken for a
    // navigation: the pop is swallowed, no step forward.
    window.history.replaceState({ __NA: true }, "");
    back.mockRestore();
    const forward = vi.spyOn(window.history, "forward");
    expect(browser.back()).toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("keeps a registered key through the router's same-URL state replaces", async () => {
    fakeBrowser();
    const { keepHistoryStateKey } = await load();
    keepHistoryStateKey("__squirrelScroll");
    window.history.replaceState({ __NA: true, __squirrelScroll: 420 }, "");

    // The router's commit: its own state only, URL unchanged.
    window.history.replaceState({ __NA: true, tree: "new" }, "", window.location.href);
    expect(window.history.state).toEqual({ __NA: true, tree: "new", __squirrelScroll: 420 });

    // A newer value in the replace wins, and a key nobody registered goes.
    window.history.replaceState({ __NA: true, __squirrelScroll: 12, other: 1 }, "");
    window.history.replaceState({ __NA: true }, "");
    expect(window.history.state).toEqual({ __NA: true, __squirrelScroll: 12 });

    // Another URL is another page: it starts without the key.
    window.history.replaceState({ __NA: true }, "", "https://app.test/dashboard/tasks");
    expect(window.history.state).toEqual({ __NA: true });
  });

  it("lets the router handle a back that leaves the page the dialog was opened on", async () => {
    const browser = fakeBrowser("https://app.test/dashboard/inventory/items/a");
    const { pushDialogEntry } = await load();
    const close = vi.fn();
    // The dialog was opened on /b, after navigating there from /a.
    browser.navigate("https://app.test/dashboard/inventory/items/b");
    pushDialogEntry(close);

    // A long-press back that jumps two entries, straight to /a.
    window.history.back();
    window.history.back();
    const stopped = browser.pop();

    expect(close).toHaveBeenCalledOnce();
    expect(stopped).not.toHaveBeenCalled();
  });

  it("keeps the router's own state on the pushed entry", async () => {
    fakeBrowser();
    const { pushDialogEntry } = await load();
    pushDialogEntry(vi.fn());
    expect(window.history.state).toMatchObject({ __NA: true });
  });

  it("marks <html> while its own back() is on its way, for the e2e suite", async () => {
    const browser = fakeBrowser();
    const attributes = new Set<string>();
    vi.stubGlobal("document", {
      documentElement: {
        toggleAttribute: (name: string, on: boolean) => (on ? attributes.add(name) : attributes.delete(name)),
      },
    });
    const { pushDialogEntry, DIALOG_BACK_PENDING_ATTR } = await load();
    const release = pushDialogEntry(vi.fn());
    expect(attributes.has(DIALOG_BACK_PENDING_ATTR)).toBe(false);

    release();
    expect(attributes.has(DIALOG_BACK_PENDING_ATTR)).toBe(true);
    browser.pop();
    expect(attributes.has(DIALOG_BACK_PENDING_ATTR)).toBe(false);
  });
});
