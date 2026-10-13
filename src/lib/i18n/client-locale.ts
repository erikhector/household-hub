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

/**
 * The locale the server rendered the page in, read from `<html lang>`
 * (RootLayout sets it from getLocale()). Unlike the cookie it also covers a
 * signed-in user whose account locale was set on another device, so there is
 * no cookie here yet. For client UI that appears after hydration (a dialog's
 * Close label), where the first render can't mismatch.
 */
export function getDocumentLocale(): Locale {
  if (typeof document === "undefined") return defaultLocale;
  const value = document.documentElement.lang;
  return isLocale(value) ? value : getClientLocale();
}
