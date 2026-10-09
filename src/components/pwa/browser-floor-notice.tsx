"use client";

// UX-29 browser floor: Squirrel's design tokens are oklch() with color-mix()
// tints, which Safari/iOS only learned in 16.4 (current Chrome, Edge and
// Firefox are fine). Below that the tokens never resolve and the UI paints
// half-unstyled, so this banner says so and names the way out. Rendered in
// the root layout on every page; null on a modern browser.
//
// Read via useSyncExternalStore, not useState+useEffect: CSS support is a
// browser-only value that would otherwise mismatch between the
// server-rendered HTML and hydration (same shape as install-app-card.tsx).
// The server snapshot assumes support, so SSR HTML has no banner and an old
// browser gains it right after hydration — no layout shift for everyone
// else, and no flash of wrongly-styled content either way.

import { useSyncExternalStore } from "react";
import { TriangleAlert } from "lucide-react";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

/** The CSS features the app's design tokens require. Exported for tests. */
export const REQUIRED_CSS_FEATURES = [
  "oklch(0.5 0.1 200)",
  "color-mix(in oklab, red 50%, blue)",
] as const;

export function supportsBrowserFloor(): boolean {
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") return false;
  return REQUIRED_CSS_FEATURES.every((color) => CSS.supports("color", color));
}

const subscribe = () => () => {};
const getServerSnapshot = () => true;

export function BrowserFloorNotice({ dict }: { dict: Dictionary["browserFloor"] }) {
  const supported = useSyncExternalStore(subscribe, supportsBrowserFloor, getServerSnapshot);
  if (supported) return null;
  return (
    <div role="region" aria-label={dict.title} className="border-b border-warning/30 bg-warning/10 px-4 py-2">
      <p className="mx-auto flex max-w-3xl items-start gap-2 text-sm text-warning">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          <strong className="font-semibold">{dict.title}. </strong>
          {dict.message}
        </span>
      </p>
    </div>
  );
}
