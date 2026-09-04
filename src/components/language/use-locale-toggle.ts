"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLocaleAction } from "@/lib/actions/locale";
import type { Locale } from "@/lib/i18n/locales";

export function useLocaleToggle(locale: Locale) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const next: Locale = locale === "en" ? "sv" : "en";

  function toggle() {
    startTransition(() => {
      setLocaleAction(next).then(() => router.refresh());
    });
  }

  return { next, toggle, isPending };
}
