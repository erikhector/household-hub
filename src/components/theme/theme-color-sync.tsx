"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { THEME_COLORS } from "@/components/theme/theme-choice";

// UX-51: layout.tsx's viewport themeColor picks its colour with a
// prefers-color-scheme media query, which only knows the operating system's
// scheme. A visitor who chose Dark on a light phone (or the reverse) would get
// light browser chrome over a dark page, so once the real theme is known the
// tags are set to its colour outright. Renders nothing.
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
