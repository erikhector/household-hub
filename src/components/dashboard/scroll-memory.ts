// UX-193 (DESIGN.md M7): Back and Forward land where the reader left.
//
// The browser's own scroll restoration can't do it in the dashboard. On a
// phone the document never scrolls, `main` does (see dashboard/layout.tsx),
// and no browser restores an inner scroller. On a desktop the document
// scrolls, but a Back to a page the router has to fetch again first
// commits the route's loading.tsx skeleton, which is a screen tall, so the
// position the browser restores is clamped to the top and nothing scrolls
// again when the real page streams in. Both were measured on Profile;
// every dashboard page has a skeleton and the same shell, so this is fixed
// once here, not per page.
//
// So each history entry remembers its own offset, in history.state next to
// Next's router state (the way dialog-history.ts keeps its marker). Nothing
// is written to cookies or web storage, and it goes when the tab does. On a
// Back/Forward to another page the offset is put back once the skeleton is
// gone and the page is tall enough to scroll that far.
//
// ScrollRestoration (scroll-restoration.tsx) wires this to the dashboard
// shell. The whole flow is covered through the browser in
// e2e/ux-193.spec.ts; the helpers below it are unit-tested.

import { keepHistoryStateKey } from "@/components/ui/dialog-history";

// Our offset inside history.state. Spread onto Next's own state (which
// carries __NA and the router tree), so its replaceState patch passes the
// entry through untouched.
const KEY = "__squirrelScroll";
// The scroller on a phone, and the element whose content is watched.
const MAIN_ID = "main-content";
// PageSkeleton and dashboard/loading.tsx carry this attribute.
const SKELETON_SELECTOR = "[data-page-skeleton]";
// A scroll only reaches history.state once it has been still this long:
// Safari throws once replaceState is called more than 100 times in 30 s.
const SAVE_DELAY_MS = 150;
// How long a restore keeps waiting for the page to stream in and grow tall
// enough. After that the reader has started reading wherever they are.
const GIVE_UP_MS = 15_000;

type Pending = { url: string; y: number; done: boolean };

// The Back/Forward being restored, kept (done) until the next page so
// ScrollToHash can tell this page view was a restore.
let pending: Pending | null = null;
// pathname + search of the page React last committed.
let committedUrl: string | null = null;
// A Back/Forward has moved the URL to a page React hasn't committed yet:
// the page on screen is still the one being left.
let awaitingCommit = false;
// The newest offset seen, waiting for SAVE_DELAY_MS of stillness.
let unsaved: { url: string; y: number } | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let stopRestoring: (() => void) | null = null;
let installed = false;

function pageUrl(): string {
  return window.location.pathname + window.location.search;
}

/** The offset an entry's history.state remembers, if any. */
export function savedOffset(state: unknown): number | null {
  if (!state || typeof state !== "object") return null;
  const y = (state as Record<string, unknown>)[KEY];
  return typeof y === "number" && Number.isFinite(y) && y >= 0 ? y : null;
}

/** `state` with the offset added, Next's own keys untouched. */
export function withOffset(state: unknown, y: number): Record<string, unknown> {
  return { ...(state && typeof state === "object" ? state : {}), [KEY]: y };
}

// On a phone `main` scrolls; from `sm` up it doesn't and the document does.
function mainIfScroller(): HTMLElement | null {
  const main = document.getElementById(MAIN_ID);
  if (!main) return null;
  const overflow = getComputedStyle(main).overflowY;
  return overflow === "auto" || overflow === "scroll" ? main : null;
}

function currentOffset(): number {
  const main = mainIfScroller();
  return main ? main.scrollTop : window.scrollY;
}

function scrollToOffset(y: number) {
  const main = mainIfScroller();
  // Instant: this is where the reader already was, not a move to animate.
  if (main) main.scrollTo({ top: y, behavior: "instant" });
  else window.scrollTo({ top: y, behavior: "instant" });
}

function save() {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = null;
  const latest = unsaved;
  unsaved = null;
  // A scroll from the page before a navigation must not land in the new
  // page's entry.
  if (!latest || latest.url !== pageUrl()) return;
  if (savedOffset(window.history.state) === latest.y) return;
  window.history.replaceState(withOffset(window.history.state, latest.y), "");
}

function onScroll(event: Event) {
  // Not the reader's: between a Back and its commit the browser tries its
  // own restore on the page being left, and while our restore waits the
  // skeleton clamps the offset to the top. Remembering either would
  // overwrite the offset this entry is about to be put back to.
  if (awaitingCommit || (pending && !pending.done)) return;
  const { target } = event;
  // A list or sheet scrolling inside the page isn't the page's position.
  if (target !== document && !(target instanceof HTMLElement && target.id === MAIN_ID)) return;
  // Read from whichever scrolls, not from the event's target: on a phone
  // the document fires scroll events too (scrollIntoView reaches every
  // ancestor) while staying at 0, and that 0 must not replace main's offset.
  unsaved = { url: pageUrl(), y: Math.round(currentOffset()) };
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(save, SAVE_DELAY_MS);
}

function finishRestore() {
  if (pending) pending.done = true;
  stopRestoring?.();
  stopRestoring = null;
}

// React renders a Back to a page the router still has cached inside the
// router's own popstate listener, so by the time this one runs that page
// may already be committed and routeCommitted has dealt with it. This is
// for the other case: the page has to be fetched first, and until it
// commits no scroll is the reader's (see onScroll). A pop that stays on
// the page (a dialog's entry closing, a hash) is neither.
function onPopState() {
  if (pageUrl() === committedUrl) return;
  awaitingCommit = true;
  unsaved = null;
}

function tryRestore() {
  if (!pending || pending.done) return;
  // The skeleton is a screen tall: scrolling it would only clamp.
  if (document.querySelector(SKELETON_SELECTOR)) return;
  scrollToOffset(pending.y);
  if (Math.abs(currentOffset() - pending.y) <= 1) finishRestore();
}

/**
 * Call when React has committed a new page (pathname or search changed).
 * An entry that remembers an offset can only be one the reader has come
 * back to: a link pushes a new entry, which has none until it is scrolled.
 * This is the first moment the page in the DOM is the one the offset
 * belongs to, though often still as its skeleton, so it keeps trying as
 * the content streams in.
 */
export function routeCommitted() {
  awaitingCommit = false;
  const url = pageUrl();
  // The first page of a load (a reload is left to the browser), or a
  // second call for the same page.
  if (url === committedUrl) return;
  committedUrl = url;
  finishRestore();
  unsaved = null;
  // Read now, before any scroll of the new page can be remembered.
  const y = savedOffset(window.history.state);
  pending = y === null ? null : { url, y, done: false };
  if (!pending) return;
  const main = document.getElementById(MAIN_ID);
  if (!main) return finishRestore();
  const observer = new MutationObserver(tryRestore);
  observer.observe(main, { childList: true, subtree: true });
  const timer = setTimeout(finishRestore, GIVE_UP_MS);
  // The reader moving the page themselves always wins over us.
  const inputs = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
  for (const type of inputs) window.addEventListener(type, finishRestore, { capture: true, passive: true });
  stopRestoring = () => {
    observer.disconnect();
    clearTimeout(timer);
    for (const type of inputs) window.removeEventListener(type, finishRestore, { capture: true });
  };
  tryRestore();
}

/**
 * True when this page view is a Back/Forward whose offset is being (or was)
 * put back. ScrollToHash stands down then: the hash's section is only the
 * nearest guess at where the reader was, and this is the real position.
 */
export function restoresThisPage(): boolean {
  if (!installed) return false;
  // ScrollToHash's effect can run before ScrollRestoration's when one
  // commit brings both the route and the page.
  routeCommitted();
  return pending !== null && pending.url === pageUrl();
}

/** Starts remembering offsets. Idempotent; the listeners stay for the tab's life. */
export function installScrollMemory() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  committedUrl = pageUrl();
  // Capture: scroll doesn't bubble, and this hears both the document's and
  // main's from one listener.
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  // A click may be a link: write the offset before the router pushes the
  // next entry, in case the scroll stopped less than SAVE_DELAY_MS ago.
  document.addEventListener("click", save, { capture: true });
  window.addEventListener("pagehide", save);
  window.addEventListener("popstate", onPopState);
  // The router replaces the current entry's state on every commit (a
  // refresh, a Server Action's result) without our key, which would forget
  // the offset until the next scroll, so it's carried over.
  keepHistoryStateKey(KEY);
}
