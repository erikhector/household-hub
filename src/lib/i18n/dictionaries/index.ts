// Pure data — no "next/headers"/auth/prisma imports, unlike
// src/lib/i18n/get-dictionary.ts's request-aware getLocale()/getDictionary().
// Kept separate so contexts with no request to read from (e.g.
// src/lib/email.ts, building a translated email for a recipient's already-
// known stored locale) can pull in just the dictionaries themselves without
// dragging in that request-scoped machinery — and by extension the auth/
// Prisma imports getUserPreferences() pulls in, which would otherwise leak
// into every test that merely imports email.ts.
import type { Locale } from "@/lib/i18n/locales";
import { en, type Dictionary } from "./en";
import { sv } from "./sv";

export const dictionaries: Record<Locale, Dictionary> = { en, sv };

export function getDictionaryForLocale(locale: Locale): Dictionary {
  return dictionaries[locale];
}

export type { Dictionary };
