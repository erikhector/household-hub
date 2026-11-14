"use client";

// UX-192: rendered by ReleaseList on the full history (`?all=1`). "Show
// older updates" links to `?all=1#release-<version>`; once hydrated that is
// a soft navigation, and the link that had focus isn't on the new page.
// Next 16 scrolls the hash target into view but leaves focus alone (its
// scroll handler says so: "resetting focus on navigation is deferred"), so
// focus fell to <body> and a keyboard or screen-reader user started again
// from the top of the page instead of at the release they asked for (M10).
// This moves focus to the release the URL's hash names. The cards carry
// tabIndex={-1} so they can take it.
//
// It takes no props on purpose: the releases live in releases.json, which a
// client module must not import (client-bundle.test.ts), and the hash never
// reaches the server.

import { useEffect } from "react";

export function FocusReleaseAnchor() {
  useEffect(() => {
    // A version (`release-1.2.3`) has nothing to percent-decode.
    const id = window.location.hash.slice(1);
    if (!id.startsWith("release-")) return;
    // Only when focus is nowhere: someone who has already tabbed to a
    // control (on a full page load, before hydration) keeps their place.
    if (document.activeElement && document.activeElement !== document.body) return;
    // preventScroll: Next (or the browser, on a full load) has already
    // scrolled the card into view under `scroll-mt-4`.
    document.getElementById(id)?.focus({ preventScroll: true });
  }, []);

  return null;
}
