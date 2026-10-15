// UX-35: a delete that waits for its Undo window to close before it reaches
// the server. The row hides at once; the delete only goes out when the toast
// times out or is swiped away, the page is hidden, or the row unmounts. Undo
// before then just shows the row again, so no restore action is needed (the
// rows have cascading children that a restore would have to rebuild).
//
// Accepted trade-off: if the browser is killed outright inside the window,
// nothing was sent and the row is still there next time. Nothing is lost
// that the user didn't get back.
//
// Every path that can end the window (Undo click, the toast's own dismiss
// that follows it, auto-close, page hide, unmount) calls commit or undo, so
// both are guarded to settle exactly once.

export type DeferredDelete = { commit: () => void; undo: () => void };

export function createDeferredDelete({
  run,
  restore,
}: {
  /** Sends the delete; resolves false when it failed (already toasted). */
  run: () => Promise<boolean>;
  /** Shows the row again. */
  restore: () => void;
}): DeferredDelete {
  let settled = false;
  return {
    commit() {
      if (settled) return;
      settled = true;
      void run().then((ok) => {
        if (!ok) restore();
      });
    },
    undo() {
      if (settled) return;
      settled = true;
      restore();
    },
  };
}
