"use client";

// A remembered choice (a filter, a view) kept in localStorage, the same
// shape as useDismissedLocalStorage (see its notes): read through
// useSyncExternalStore with a null server snapshot, so SSR and the first
// client render agree and React swaps in the stored value right after
// hydration; a local override makes a change take effect at once and still
// hold for this page view when storage throws (private browsing, blocked
// site data).
//
// `key` is typed to the keys exported by src/lib/cookie-inventory.ts, so a
// preference can't be stored without being listed on the privacy page.

import { useCallback, useState, useSyncExternalStore } from "react";
import type { PreferenceStorageKey } from "@/lib/cookie-inventory";

function subscribe() {
  return () => {};
}

function getServerSnapshot(): string | null {
  return null;
}

function read(key: PreferenceStorageKey): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function useLocalPreference(
  key: PreferenceStorageKey,
): readonly [value: string | null, setValue: (next: string) => void] {
  const stored = useSyncExternalStore(subscribe, () => read(key), getServerSnapshot);
  const [local, setLocal] = useState<string | null>(null);

  const setValue = useCallback(
    (next: string) => {
      setLocal(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        // Storage unavailable: `local` still holds it for this page view.
      }
    },
    [key],
  );

  return [local ?? stored, setValue] as const;
}
