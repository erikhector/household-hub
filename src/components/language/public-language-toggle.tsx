"use client";

import { useLocaleToggle } from "@/components/language/use-locale-toggle";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { Locale } from "@/lib/i18n/locales";

// The logged-out counterpart of the sidebar / bottom-bar language buttons:
// names the language it switches *to* (like those do), reusing the same
// hook so the cookie is set by setLocaleAction. min-h-11 keeps the tap
// target at 44 px (DESIGN.md M3) even though the text is small.
export function PublicLanguageToggle({
  locale,
  dict,
}: {
  locale: Locale;
  dict: Dictionary["language"];
}) {
  const { next, toggle, isPending } = useLocaleToggle(locale);
  const label = next === "sv" ? dict.swedish : dict.english;

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isPending}
      lang={next}
      aria-label={`${dict.toggleLabel}: ${label}`}
      className="inline-flex min-h-11 items-center rounded-md px-3 text-xs font-medium hover:text-foreground hover:underline"
    >
      {label}
    </button>
  );
}
