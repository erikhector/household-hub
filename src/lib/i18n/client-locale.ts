import { defaultLocale, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n/locales";

/**
 * Client-safe counterpart to get-dictionary.ts's getLocale() — that one is
 * `server-only` (reads via next/headers' cookies()), so Client Components
 * that need the locale before any server round-trip (error boundaries,
 * not-found) read the same cookie directly via document.cookie instead.
 */
export function getClientLocale(): Locale {
  if (typeof document === "undefined") return defaultLocale;

  const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`));
  const value = match ? decodeURIComponent(match[1]) : undefined;
  return isLocale(value) ? value : defaultLocale;
}
