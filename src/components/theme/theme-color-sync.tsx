"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { THEME_COLORS } from "@/components/theme/theme-choice";

// UX-51: layout.tsx's viewport themeColor picks its colour with a
// prefers-color-scheme media query, which only knows the operating system's
// scheme. A visitor who chose Dark on a light phone (or the reverse) would get
// light browser chrome over a dark page, so once the page's theme is known
// every tag is set to the page's colour, whichever scheme its media query
// names. Comparing with the system scheme instead would go stale: an
// explicit theme doesn't change when the phone flips light/dark at sunset,
// so nothing would re-run. With "system", next-themes updates resolvedTheme
// on that flip, so this re-runs. The server-rendered per-scheme tags still
// cover first paint before hydration. Renders nothing.
export function ThemeColorSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return;
    for (const tag of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      tag.content = THEME_COLORS[resolvedTheme];
    }
  }, [resolvedTheme]);

  return null;
}
