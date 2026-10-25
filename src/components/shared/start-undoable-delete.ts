"use client";

import { toast } from "sonner";
import { createDeferredDelete } from "@/components/shared/deferred-delete";

const UNDO_WINDOW_MS = 5000;

// UX-49: the same Undo-toast delete as use-undoable-delete.ts, for a delete
// started from a handler rather than a row component of its own (the
// inventory table's shared ⋯ menu, a planner meal, the transaction sheet, a
// recipe card). The caller hides the row first (local-row-changes'
// markDeleted, or by navigating away) and passes `restore` to show it again.
// The delete only goes out when the toast closes; the closure outlives the
// component, so a row that unmounts inside the window (a route change) is
// still deleted when the toast times out. Leaving or hiding the page ends
// the window at once, as in the hook.
export function startUndoableDelete({
  run,
  restore,
  message,
  undoLabel,
}: {
  /** Sends the delete; resolves false when it failed (already toasted). */
  run: () => Promise<boolean>;
  /** Shows the row again, for an Undo or a failed delete. */
  restore: () => void;
  message: string;
  undoLabel: string;
}) {
  const flush = () => {
    if (document.visibilityState === "hidden") deferred.commit();
  };
  const done = () => document.removeEventListener("visibilitychange", flush);
  const deferred = createDeferredDelete({
    run: () => {
      done();
      return run();
    },
    restore: () => {
      done();
      restore();
    },
  });
  document.addEventListener("visibilitychange", flush);
  toast(message, {
    duration: UNDO_WINDOW_MS,
    action: { label: undoLabel, onClick: deferred.undo },
    onAutoClose: deferred.commit,
    onDismiss: deferred.commit,
  });
}
