"use client";

// UX-33: a tick, an untick or a delete moves the row at tap time. Before,
// the row's checkbox flipped at once (UX-14's `useOptimistic`) but the row
// stayed where it was until the server answered. When that took over
// 500 ms (weak signal in a shop) the browser's layout-shift metric
// counted the move, because it no longer followed a tap. Now the list keeps
// what you've just done locally, lays itself out from that, and saves in
// the background:
//
// - the mark is applied with `flushSync`, so it shows on the next frame
//   even when it's made inside another transition (a confirm dialog's) or
//   while an earlier save is still on its way (transitions started while an
//   async action is pending wait for it, an urgent update doesn't);
// - once the save is settled the mark is dropped inside a transition, so
//   it goes in the same commit as the server's refreshed list. On success
//   the two agree and nothing moves. On failure (settleOptimisticAction or
//   the dialog toasts why) the server's list is unchanged and the row
//   glides back (M5: an optimistic update rolls back visibly);
// - each mark has a sequence number, so a quick tick-untick drops only the
//   mark of the save that finished.

import { startTransition, useRef, useState } from "react";
import { flushSync } from "react-dom";

export type LocalRowChange = { seq: number; done?: boolean; deleted?: boolean };

/** The rows as they should show: deleted ones gone, ticked ones flipped. */
export function applyLocalRowChanges<T extends { id: string }>(
  rows: readonly T[],
  changes: ReadonlyMap<string, LocalRowChange>,
  withDone: (row: T, done: boolean) => T,
): T[] {
  if (changes.size === 0) return [...rows];
  return rows.flatMap((row) => {
    const change = changes.get(row.id);
    if (!change) return [row];
    if (change.deleted) return [];
    return change.done === undefined ? [row] : [withDone(row, change.done)];
  });
}

/**
 * The local marks and the two ways to make one. Each returns `settle`, to
 * call once the save has finished, however it went.
 */
export function useLocalRowChanges() {
  const [changes, setChanges] = useState<ReadonlyMap<string, LocalRowChange>>(() => new Map());
  const lastSeq = useRef(0);

  function mark(id: string, change: Omit<LocalRowChange, "seq">) {
    const seq = ++lastSeq.current;
    flushSync(() => setChanges((current) => new Map(current).set(id, { ...change, seq })));
    return function settle() {
      startTransition(() =>
        setChanges((current) => {
          if (current.get(id)?.seq !== seq) return current;
          const next = new Map(current);
          next.delete(id);
          return next;
        }),
      );
    };
  }

  return {
    changes,
    markDone: (id: string, done: boolean) => mark(id, { done }),
    markDeleted: (id: string) => mark(id, { deleted: true }),
  };
}
