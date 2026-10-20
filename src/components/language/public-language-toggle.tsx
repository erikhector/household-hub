"use client";

import { format } from "@/lib/i18n/format";
import { useLocaleToggle } from "@/components/language/use-locale-toggle";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { Locale } from "@/lib/i18n/locales";

// The logged-out counterpart of the sidebar / More-menu language buttons,
// next to PublicThemeToggle in the legal footer: names the language in use
// ("Language: English", like those do since UX-51; a bare "Swedish" read as
// the current language) and a tap switches to the other. Reuses the same
// hook so the cookie is set by setLocaleAction. min-h-11 keeps the tap
// target at 44 px (DESIGN.md M3) even though the text is small.
export function PublicLanguageToggle({
  locale,
  dict,
}: {
  locale: Locale;
  dict: Dictionary["language"];
}) {
  const { toggle, isPending } = useLocaleToggle(locale);
  const current = locale === "sv" ? dict.swedish : dict.english;

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isPending}
      aria-label={`${dict.toggleLabel}: ${current}`}
      className="inline-flex min-h-11 items-center rounded-md px-3 text-xs font-medium hover:text-foreground hover:underline"
    >
      {format(dict.current, { language: current })}
    </button>
  );
}
