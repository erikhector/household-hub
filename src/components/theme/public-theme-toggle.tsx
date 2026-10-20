"use client";

import { format } from "@/lib/i18n/format";
import { useThemeCycle } from "@/components/theme/use-theme-cycle";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

// The logged-out counterpart of the sidebar / More-menu theme button, next to
// PublicLanguageToggle in the legal footer: shows the theme in use and a tap
// moves to the next. min-h-11 keeps the 44 px tap target (DESIGN.md M3).
export function PublicThemeToggle({ dict }: { dict: Dictionary["theme"] }) {
  const { current, Icon, cycle } = useThemeCycle();

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`${dict.toggleLabel}: ${dict[current]}`}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-xs font-medium hover:text-foreground hover:underline"
    >
      <Icon className="size-4" aria-hidden />
      {format(dict.current, { theme: dict[current] })}
    </button>
  );
}
