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
// lands on, and whether anything pushed or replaced an entry before it did.
let ownBack: { href: string; overwritten: boolean } | null = null;

// <html> carries this while ownBack is set, so the e2e suite's
// waitForDialogHistory can wait for that back() to land: a page.reload()
// issued before it does races it and comes back net::ERR_ABORTED. Nothing
// in the app reads it.
export const DIALOG_BACK_PENDING_ATTR = "data-dialog-back-pending";

function setOwnBack(value: typeof ownBack) {
  ownBack = value;
  if (typeof document !== "undefined") document.documentElement.toggleAttribute(DIALOG_BACK_PENDING_ATTR, value !== null);
}

function markerOf(state: unknown): unknown {
  return state && typeof state === "object" ? (state as Record<string, unknown>)[KEY] : undefined;
}

function onPopState(event: PopStateEvent) {
  let swallow = false;
  if (ownBack !== null) {
    const { href, overwritten } = ownBack;
    setOwnBack(null);
    if (overwritten) {
      // Something got in before our back() landed: the app navigated right
      // after closing the dialog (the item page's merge dialog closes, then
      // replaces the URL with the kept item's page), or another dialog
      // opened. The back undid that, so step forward onto it again.
      event.stopImmediatePropagation();
      window.history.forward();
      return;
    }
    swallow = window.location.href === href;
  }
  const landedOn = markerOf(event.state);
  while (stack.length > 0 && stack[stack.length - 1].id !== landedOn) {
    const entry = stack.pop()!;
    // A long-press back can jump past the page the dialog was opened on;
    // then the URL changed and the router must handle it as usual.
    if (window.location.href === entry.href) swallow = true;
    entry.close();
  }
  if (swallow) event.stopImmediatePropagation();
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
  history.pushState = (...args: Parameters<History["pushState"]>) => {
    if (ownBack !== null) ownBack.overwritten = true;
    return originalPush(...args);
  };
  history.replaceState = (data: unknown, unused: string, url?: string | URL | null) => {
    const sameUrl = url == null || new URL(url, window.location.href).href === window.location.href;
    const marker = markerOf(history.state);
    if (sameUrl && marker !== undefined && data && typeof data === "object" && markerOf(data) === undefined) {
      data = { ...data, [KEY]: marker };
    }
    if (!sameUrl && ownBack !== null) ownBack.overwritten = true;
    return originalReplace(data, unused, url);
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
  const state = window.history.state;
  window.history.pushState({ ...(state && typeof state === "object" ? state : {}), [KEY]: entry.id }, "");
  stack.push(entry);

  return () => {
    const index = stack.indexOf(entry);
    // Already gone: the back gesture is what closed it.
    if (index === -1) return;
    stack.splice(index, 1);
    // Only when ours is still on top. If the app navigated meanwhile (or a
    // dialog under another one closed first), going back would undo
    // something else, so the entry is left behind as a harmless same-URL
    // step.
    if (markerOf(window.history.state) === entry.id) {
      setOwnBack({ href: entry.href, overwritten: false });
      window.history.back();
    }
  };
}
