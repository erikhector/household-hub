import type { Locale } from "@/lib/i18n/locales";

// The few strings that primitives without a `dict` prop need ("Close" on every
// dialog, "Loading" on every skeleton, "Back to top" on the phone's compact
// page title). They live in their own tiny module,
// not only in the full dictionaries, so a Client Component such as
// components/ui/dialog.tsx can read them via getClientLocale() without
// pulling both whole dictionaries into the browser bundle. en.ts and sv.ts
// use these as `common`, so there is still one source per language.
export const commonCopy: Record<Locale, { loading: string; close: string; backToTop: string }> = {
  en: { loading: "Loading", close: "Close", backToTop: "Back to top" },
  sv: { loading: "Laddar", close: "Stäng", backToTop: "Till toppen" },
};
