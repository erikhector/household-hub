import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { defaultLocale, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n/locales";
import { dictionaries, getDictionaryForLocale, type Dictionary } from "@/lib/i18n/dictionaries";
import { getUserPreferences } from "@/lib/preferences";

// Cached per-request: every Server Component that needs translations calls
// this independently (no [locale] route segment to thread a param through —
// see REQUIREMENTS.md's "Internationalization" section for why), so `cache`
// dedupes the repeated `cookies()`/getUserPreferences() reads within one
// request.
//
// A signed-in user's account-level locale (src/lib/preferences.ts) wins so
// the choice follows them across devices; the `locale` cookie — set by
// setLocaleAction (src/lib/actions/locale.ts) on every change, logged in or
// not — is the fallback for anonymous/pre-auth pages (login, signup) that
// have no user row to read.
export const getLocale = cache(async (): Promise<Locale> => {
  const prefs = await getUserPreferences();
  if (prefs && isLocale(prefs.locale)) return prefs.locale;

  const cookieStore = await cookies();
  const value = cookieStore.get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : defaultLocale;
});

export const getDictionary = cache(async (): Promise<Dictionary> => {
  const locale = await getLocale();
  return dictionaries[locale];
});

export { getDictionaryForLocale };
export type { Dictionary, Locale };
