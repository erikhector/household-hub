"use client";

import { useEffect } from "react";

/**
 * Scrolls the element the URL's hash names into view once the page has
 * mounted. A client-side <Link> to `/page#section` first commits the
 * route's loading.tsx skeleton, so Next's own hash scroll runs while the
 * target isn't in the DOM yet and nothing scrolls again when the real page
 * streams in (UX-191: the notification centre's "Notification settings"
 * link left Profile at the top on a slow load). Render it once on a page
 * that is linked to by hash. It only acts on mount, so the page's own
 * in-page anchors (the Profile jump chips) keep the browser's behaviour.
 *
 * It also runs when Back or Forward remounts the page, on purpose: the
 * page streams in behind the skeleton then too, so the position the
 * browser restores is the top (measured on Profile, with and without a
 * hash, document scroll and the phone's `main` scroll alike). Landing on
 * the section the hash names is the nearer of the two to where the reader
 * left.
 */
export function ScrollToHash() {
  useEffect(() => {
    const raw = window.location.hash.slice(1);
    if (!raw) return;
    // An id with a space or a non-ASCII letter arrives percent-encoded. A
    // malformed escape (`#%`, a truncated pasted link) makes the decode
    // throw, and an error in an effect takes the whole page to the error
    // boundary, so fall back to the raw hash, which just finds nothing.
    let id = raw;
    try {
      id = decodeURIComponent(raw);
    } catch {}
    // Instant, not smooth: the user already asked to go there, and an
    // animation would ignore prefers-reduced-motion.
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, []);
  return null;
}
