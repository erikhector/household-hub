// Plain (non-"use client") module so server code (src/lib/preferences.ts,
// src/app/layout.tsx) can validate a stored theme value without importing
// use-theme-cycle.ts's "use client" hook.
export const THEME_CHOICES = ["light", "dark", "system"] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === "string" && (THEME_CHOICES as readonly string[]).includes(value);
}
