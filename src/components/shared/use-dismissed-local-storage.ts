"use client";

// One home for the "remember what the user dismissed" pattern that the
// recap cards and the use-it-up chips each used to hand-roll (MAINT-9):
// a localStorage value read through useSyncExternalStore, plus a local
// override so a dismissal takes effect at once and still works when storage
// is unavailable.
//
// `key` is typed to the dismissal keys exported by src/lib/cookie-inventory.ts,
// so a new dismissal can't be stored without being listed on the privacy page.
//
// - useSyncExternalStore (not useState+useEffect) is the React-recommended
//   way to read a browser-only value during render. The server snapshot is
//   always null, so SSR and the first client render agree (no hydration
//   mismatch) and React swaps in the stored value right after hydration.
// - Nothing external notifies us of changes (a dismissal made in this tab
//   goes through the `local` state below), so subscribe is a stable no-op.
// - Private browsing / blocked site data make localStorage throw: reads fall
//   back to null ("not dismissed") and writes are swallowed, so the dismissal
//   holds for this page view but won't survive navigation.

import { useCallback, useState, useSyncExternalStore } from "react";
import type { DismissedStorageKey } from "@/lib/cookie-inventory";

function subscribe() {
  return () => {};
}

function getServerSnapshot(): string | null {
  return null;
}

function read(key: DismissedStorageKey): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Returns the stored dismissal value (null before hydration or when nothing is
 * stored) and a setter that updates it immediately and persists it.
 */
export function useDismissedLocalStorage(
  key: DismissedStorageKey,
): readonly [value: string | null, setValue: (next: string) => void] {
  const stored = useSyncExternalStore(subscribe, () => read(key), getServerSnapshot);
  const [local, setLocal] = useState<string | null>(null);

  const setValue = useCallback(
    (next: string) => {
      setLocal(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        // Storage unavailable: `local` still hides it for this page view.
      }
    },
    [key],
  );

  return [local ?? stored, setValue] as const;
}
