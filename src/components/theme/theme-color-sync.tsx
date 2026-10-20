"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { THEME_COLORS } from "@/components/theme/theme-choice";

// UX-51: layout.tsx's viewport themeColor picks its colour with a
// prefers-color-scheme media query, which only knows the operating system's
// scheme. A visitor who chose Dark on a light phone (or the reverse) would get
// light browser chrome over a dark page, so when the page's theme differs
// from the system's, every tag is set to the page's colour outright. When
// they agree, each tag goes back to its own per-scheme colour (the markup the
// server rendered). Renders nothing.
export function ThemeColorSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return;
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const matches = (resolvedTheme === "dark") === systemDark;
    for (const tag of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      const own = tag.media.includes("dark") ? THEME_COLORS.dark : THEME_COLORS.light;
      tag.content = matches ? own : THEME_COLORS[resolvedTheme];
    }
  }, [resolvedTheme]);

  return null;
}
