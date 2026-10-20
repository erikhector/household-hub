"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLocaleAction } from "@/lib/actions/locale";
import type { Locale } from "@/lib/i18n/locales";

export function useLocaleToggle(locale: Locale) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const next: Locale = locale === "en" ? "sv" : "en";

  // An async transition, so `isPending` lasts until the refreshed page (in
  // the new language) has arrived, not just until the request is sent; the
  // footer button shows the wait with it (DESIGN.md M5).
  function toggle() {
    startTransition(async () => {
      await setLocaleAction(next);
      router.refresh();
    });
  }

  return { next, toggle, isPending };
}
