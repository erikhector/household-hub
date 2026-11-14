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
 */
export function ScrollToHash() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    // Instant, not smooth: the user already asked to go there, and an
    // animation would ignore prefers-reduced-motion.
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, []);
  return null;
}
