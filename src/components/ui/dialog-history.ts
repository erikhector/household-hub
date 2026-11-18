// UX-11 (DESIGN.md M7): the phone's back button or back swipe closes the
// open sheet instead of leaving the page and losing the form. Each open
// dialog pushes a same-URL history entry, so "back" pops that entry and the
// popstate closes the dialog. Closing from the UI (X, Cancel, Escape, a
// submit) calls history.back() if our entry is still on top, so a closed
// dialog leaves no extra back step behind.
//
// One module-level listener owns the stack of open dialogs, so a back from
// a nested dialog closes only the top one: everything above the entry the
// browser landed on closes, everything at or below it stays.
//
// The listener has to run before Next.js's own popstate handler so it can
// stop it: a pop that only closed a dialog (or undid our own back()) lands
// on the same URL, so there's nothing for the router to restore, and
// letting it run dispatches a restore that discards a navigation already
// in flight (the merge dialog closes, then router.replace()s to the kept
// item, which never happened). Listeners on window run in the order they
// were added, whatever the capture flag says, and the router adds its own
// in an effect after hydration. So this module installs itself as soon as
// it's evaluated, and the root layout renders DialogHistoryListener so
// it's evaluated on first load, before that effect, on every page.

// Our marker inside history.state. Spread onto Next's own state (which
// carries __NA and the router tree), so its pushState patch passes the
// entry through untouched and a restore onto it still works.
const KEY = "__squirrelDialog";

type Entry = { id: number; href: string; close: () => void };

const stack: Entry[] = [];
let nextId = 1;
let installed = false;
// Set while a history.back() of ours is on its way (it's async): the URL it
// lands on, the id of the closed dialog whose entry it takes off, and whether
// anything pushed or replaced an entry before it did. `repairing` is set once
// it has landed and we're stepping forward again to undo it; the back counts
// as pending until that has landed too.
let ownBack: { href: string; closedId: number; overwritten: boolean; repairing: boolean } | null = null;
// Dialogs that opened while ownBack was pending, waiting for that back() to
// land before they push their entry (see pushDialogEntry).
const deferred: Entry[] = [];
// Dialogs closed from the UI while ownBack was pending for the dialog
// stacked on top of them (a sheet and its confirm closing together,
// UX-201), waiting for that back() to land on their entry so they can take
// it off too (see pushDialogEntry's release).
const releasing: Entry[] = [];
// The app's own pushState/replaceState calls that came after it navigated
// under a pending back() (ownBack.overwritten), held until the repair has
// landed. MAINT-113: by then the browser is, or is about to be, on an entry
// the app has left (the page under the closed dialog, or the dialog's own
// entry the repair steps through), so writing there rewrites the wrong
// entry: the tasks page the palette pushed strips its `?add=1` with
// router.replace() at once, that replace rewrote an entry below, and the
// repair then landed on the untouched `?add=1` entry, which the router
// restored. Applied where the repair lands, they reach the entry the app
// meant.
const heldWrites: (() => void)[] = [];
// The safety valve for heldWrites. Holding them is only safe while the
// popstates of our back() and its repair keep arriving, and nothing promises
// they do: a forward() that finds no entry above (the browser pruned it, or
// something else rewrote history) fires none, and another popstate listener
// can stop one before it reaches us. Then the app's writes would wait for
// the rest of the session, the URL frozen while the router moves on. So if
// no popstate of ours has come for this long after a write was held, the
// back is given up on: the writes are applied where the browser is, and
// ownBack is cleared so later ones go straight through. Each step of the
// repair re-arms it, so a slow but progressing repair isn't cut short;
// a back or forward lands in milliseconds, so a second is generous even on
// a loaded CI runner.
const HELD_WRITES_TIMEOUT_MS = 1000;
let heldWritesTimer: ReturnType<typeof setTimeout> | null = null;

function armHeldWritesValve() {
  if (heldWritesTimer !== null) clearTimeout(heldWritesTimer);
  heldWritesTimer = setTimeout(releaseHeldWrites, HELD_WRITES_TIMEOUT_MS);
}

function releaseHeldWrites() {
  heldWritesTimer = null;
  if (ownBack === null) return;
  setOwnBack(null);
  releasing.length = 0;
  for (const write of heldWrites.splice(0)) write();
  flushDeferred();
}

// Other modules' keys in history.state that must outlive the router's
// same-URL replaces too (UX-193: the scroll offset scroll-memory.ts keeps
// per entry). Kept by the wrapper below rather than by one of their own:
// this one is installed before the router's patch, so the router's stays
// the outermost, which the e2e suite's expectRouterPatched looks for.
const keptKeys: string[] = [];

export function keepHistoryStateKey(key: string) {
  if (!keptKeys.includes(key)) keptKeys.push(key);
}

// <html> carries this while ownBack is set, so the e2e suite's
// waitForDialogHistory can wait for that back() to land: a page.reload()
// issued before it does races it and comes back net::ERR_ABORTED. Nothing
// in the app reads it.
export const DIALOG_BACK_PENDING_ATTR = "data-dialog-back-pending";

function setOwnBack(value: typeof ownBack) {
  ownBack = value;
  if (value === null && heldWritesTimer !== null) {
    clearTimeout(heldWritesTimer);
    heldWritesTimer = null;
  }
  if (typeof document !== "undefined") document.documentElement.toggleAttribute(DIALOG_BACK_PENDING_ATTR, value !== null);
}

function markerOf(state: unknown): unknown {
  return state && typeof state === "object" ? (state as Record<string, unknown>)[KEY] : undefined;
}

function onPopState(event: PopStateEvent) {
  let swallow = false;
  if (ownBack !== null) {
    if (ownBack.overwritten && !ownBack.repairing) {
      // Something got in before our back() landed: the app navigated right
      // after closing the dialog (the item page's merge dialog closes, then
      // replaces the URL with the kept item's page), or another dialog
      // opened. The back undid that, so step forward onto it again.
      ownBack.repairing = true;
      if (heldWritesTimer !== null) armHeldWritesValve();
      event.stopImmediatePropagation();
      window.history.forward();
      return;
    }
    if (ownBack.repairing && markerOf(event.state) === ownBack.closedId && window.location.href === ownBack.href) {
      // MAINT-103: the app didn't replace the closed dialog's entry, it
      // pushed a new one above it (the command palette closes, then
      // router.push()es the command's page). The browser takes our back()
      // from where history stood when we called it, so it landed on the
      // page under the dialog, and the forward from there has only reached
      // the closed dialog's own entry, still on the old URL. The page the
      // app went to is one more step up; stopping here left the palette
      // closed and the app where it was.
      if (heldWritesTimer !== null) armHeldWritesValve();
      event.stopImmediatePropagation();
      window.history.forward();
      return;
    }
    const { href, repairing } = ownBack;
    setOwnBack(null);
    // The repair's last step lands on the page the app went to, which the
    // router restores like any other forward. Unless the app wrote to its
    // history since: then this entry still holds what the router has moved
    // on from (the `?add=1` tree it has already replaced), so the writes
    // are applied here and the router, already on that page, is left alone.
    if (heldWrites.length > 0) {
      for (const write of heldWrites.splice(0)) write();
      swallow = true;
    } else if (!repairing) swallow = window.location.href === href;
  }
  const landedOn = markerOf(event.state);
  if (ownBack === null && releasing.length > 0) {
    // Our back() has landed. If it's on the entry of a dialog that closed
    // while it was on its way, that entry is stale too: take it off the
    // same way, or the next back gesture would step onto it and do nothing.
    // Anywhere else (the app navigated meanwhile), they're left behind as
    // harmless same-URL steps, as a release that isn't on top always is.
    const waiting = releasing.findIndex((entry) => entry.id === landedOn);
    const entry = waiting === -1 ? undefined : releasing.splice(waiting, 1)[0];
    if (entry === undefined) releasing.length = 0;
    else if (window.location.href === entry.href) {
      event.stopImmediatePropagation();
      setOwnBack({ href: entry.href, closedId: entry.id, overwritten: false, repairing: false });
      window.history.back();
      return;
    }
  }
  while (stack.length > 0 && stack[stack.length - 1].id !== landedOn) {
    const entry = stack.pop()!;
    // A long-press back can jump past the page the dialog was opened on;
    // then the URL changed and the router must handle it as usual.
    if (window.location.href === entry.href) swallow = true;
    entry.close();
  }
  if (swallow) event.stopImmediatePropagation();
  // The back() has landed, so a dialog that opened meanwhile can push now.
  if (ownBack === null) flushDeferred();
}

function pushEntry(entry: Entry) {
  entry.href = window.location.href;
  const state = window.history.state;
  window.history.pushState({ ...(state && typeof state === "object" ? state : {}), [KEY]: entry.id }, "");
  stack.push(entry);
}

function flushDeferred() {
  for (const entry of deferred.splice(0)) pushEntry(entry);
}

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("popstate", onPopState);
  // Wraps whatever pushState/replaceState are by now (Next.js's patched
  // ones). The router replaces the current entry's state on every commit,
  // URL unchanged, without our marker, so that's put back: otherwise an
  // open dialog would no longer recognise its entry as the current one.
  // Only a new entry, or a replace that changes the URL, counts as the app
  // navigating under a pending back().
  const { history } = window;
  const originalPush = history.pushState.bind(history);
  const originalReplace = history.replaceState.bind(history);
  const push = (...args: Parameters<History["pushState"]>) => {
    if (ownBack !== null) ownBack.overwritten = true;
    return originalPush(...args);
  };
  const replace = (data: unknown, unused: string, url?: string | URL | null) => {
    const sameUrl = url == null || new URL(url, window.location.href).href === window.location.href;
    const marker = markerOf(history.state);
    if (sameUrl && marker !== undefined && data && typeof data === "object" && markerOf(data) === undefined) {
      data = { ...data, [KEY]: marker };
    }
    const current: unknown = history.state;
    if (sameUrl && current && typeof current === "object" && data && typeof data === "object") {
      const kept: Record<string, unknown> = {};
      for (const key of keptKeys) {
        if (key in current && !(key in data)) kept[key] = (current as Record<string, unknown>)[key];
      }
      data = { ...data, ...kept };
    }
    if (!sameUrl && ownBack !== null) ownBack.overwritten = true;
    return originalReplace(data, unused, url);
  };
  const hold = (write: () => void) => {
    heldWrites.push(write);
    if (heldWritesTimer === null) armHeldWritesValve();
  };
  history.pushState = (...args: Parameters<History["pushState"]>) => {
    if (ownBack?.overwritten) hold(() => push(...args));
    else push(...args);
  };
  history.replaceState = (...args: Parameters<History["replaceState"]>) => {
    if (ownBack?.overwritten) hold(() => replace(...args));
    else replace(...args);
  };
}

install();

/**
 * Pushes a history entry for a dialog that just opened. `close` runs when
 * the user goes back past it. Call the returned function when the dialog
 * closes for any other reason: it removes the entry again (history.back())
 * if it's still the current one.
 */
export function pushDialogEntry(close: () => void): () => void {
  install();
  const entry: Entry = { id: nextId++, href: window.location.href, close };
  // A dialog that opens as another one closes (a sheet handing over to its
  // confirm) is asked to push while the closing one's back() is still on
  // its way. Pushing now would put the new entry above the old one, and the
  // back, computed from the old position, would land one entry below both:
  // the forward() that repairs that then lands on the closed dialog's stale
  // entry, not the new one, and the popstate closes the dialog that just
  // opened. So wait for the back to land, then push onto a settled history.
  if (ownBack !== null) deferred.push(entry);
  else pushEntry(entry);

  return () => {
    const waiting = deferred.indexOf(entry);
    if (waiting !== -1) {
      // Closed before its entry was ever pushed: nothing to undo.
      deferred.splice(waiting, 1);
      return;
    }
    const index = stack.indexOf(entry);
    // Already gone: the back gesture is what closed it.
    if (index === -1) return;
    stack.splice(index, 1);
    // Only when ours is still on top. If the app navigated meanwhile (or a
    // dialog under another one closed first), going back would undo
    // something else, so the entry is left behind as a harmless same-URL
    // step.
    if (markerOf(window.history.state) === entry.id) {
      setOwnBack({ href: entry.href, closedId: entry.id, overwritten: false, repairing: false });
      window.history.back();
    } else if (ownBack !== null && !ownBack.overwritten && !ownBack.repairing) {
      // The dialog on top of this one closed in the same commit (UX-201: a
      // successful revoke closes its confirm and the Share sheet together)
      // and its back() hasn't landed yet, so history.state still carries
      // its marker. Once that back lands on our entry, take ours off too.
      releasing.push(entry);
    }
  };
}
