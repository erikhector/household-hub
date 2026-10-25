"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createDeferredDelete, type DeferredDelete } from "@/components/shared/deferred-delete";

const UNDO_WINDOW_MS = 5000;

// UX-35: swipe-to-delete with an Undo toast (DESIGN.md M7, "a gesture that
// destroys data is undoable", and principle 5's "prefer undo for frequent,
// low-stakes actions"). The row hides itself while `hidden` is true; see
// deferred-delete.ts for when the delete actually goes out. The visible
// trash button and menu Delete use it too since UX-49: one delete, one Undo
// toast, however it was started.
export function useUndoableDelete({
  run,
  message,
  undoLabel,
}: {
  run: () => Promise<boolean>;
  message: string;
  undoLabel: string;
}) {
  const [hidden, setHidden] = useState(false);
  const pending = useRef<DeferredDelete | null>(null);

  useEffect(() => {
    // Leaving the page (or the row unmounting for any other reason) ends the
    // Undo window: send the delete now rather than lose it. visibilitychange
    // rather than pagehide, since a phone switching apps fires it first and
    // may never fire pagehide at all.
    const flush = () => {
      if (document.visibilityState === "hidden") pending.current?.commit();
    };
    document.addEventListener("visibilitychange", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      pending.current?.commit();
    };
  }, []);

  function remove() {
    setHidden(true);
    const deferred = createDeferredDelete({
      run: () => {
        pending.current = null;
        return run();
      },
      restore: () => {
        pending.current = null;
        setHidden(false);
      },
    });
    pending.current = deferred;
    toast(message, {
      duration: UNDO_WINDOW_MS,
      action: { label: undoLabel, onClick: deferred.undo },
      onAutoClose: deferred.commit,
      onDismiss: deferred.commit,
    });
  }

  return { hidden, remove };
}
