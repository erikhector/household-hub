"use client";

import { useEffect, useRef } from "react";
import type { DeferredDelete } from "@/components/shared/deferred-delete";

// The week planner's removals still inside their Undo window: a bulk Remove
// of planned meals and a pick removed from the tray share this list.
export function usePendingRemovals() {
  const pendingRemovals = useRef<DeferredDelete[]>([]);

  // Leaving the page ends a bulk Remove's Undo window: send the delete now
  // rather than lose it (same as useUndoableDelete).
  useEffect(() => {
    // The array is only ever pushed to, never replaced, so this is the one
    // the cleanup needs too.
    const pending = pendingRemovals.current;
    const flush = () => {
      if (document.visibilityState === "hidden") pending.forEach((d) => d.commit());
    };
    document.addEventListener("visibilitychange", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      pending.forEach((d) => d.commit());
    };
  }, []);

  return pendingRemovals;
}
