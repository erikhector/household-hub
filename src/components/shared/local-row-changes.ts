"use client";

// UX-33: a tick, an untick or a delete moves the row at tap time. Before,
// the row's checkbox flipped at once (UX-14's `useOptimistic`) but the row
// stayed where it was until the server answered. When that took over
// 500 ms (weak signal) the browser's layout-shift metric counted the move,
// because it no longer followed a tap. Now the list keeps what you've just
// done locally, lays itself out from that, and saves in the background.
// Used by the task list (ticks and deletes), inventory and the shopping
// list (deletes; shopping ticks have their own overlay, tick-overlay.ts,
// built on the same rules).
//
// - A mark is applied with `flushSync`, so it shows on the next frame even
//   when it's made inside another transition (a confirm dialog's) or while
//   an earlier save is still on its way.
// - Each save settles its own mark, outside any transition. React 19
//   entangles concurrent async transitions, so a mark dropped in one waited
//   for *every* save in flight: a failed tick stayed ticked until the last
//   of them settled (DESIGN.md M5 wants that rollback visible at once). A
//   failure drops the mark straight away and the row goes back (the caller
//   or the confirm dialog toasts why). A success keeps it, marked settled,
//   until the next server list arrives: that list already has the change,
//   so nothing moves, and it's the truth from then on (another member's
//   change included).
// - Marks carry a sequence number, so after a quick tick then untick only
//   the latest save's answer counts.

import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { unstable_rethrow } from "next/navigation";

// `skipped` (GAP-60) says the `done` flip is a task skip or its undo rather
// than a tick, so the row closes without a completion being faked.
export type LocalRowChange = { seq: number; done?: boolean; skipped?: boolean; deleted?: boolean; settled?: boolean };
export type LocalRowChanges = ReadonlyMap<string, LocalRowChange>;

/** The rows as they should show: deleted ones gone, ticked ones flipped. */
export function applyLocalRowChanges<T extends { id: string }>(
  rows: readonly T[],
  changes: LocalRowChanges,
  withDone: (row: T, done: boolean, change: LocalRowChange) => T,
): T[] {
  if (changes.size === 0) return [...rows];
  return rows.flatMap((row) => {
    const change = changes.get(row.id);
    if (!change) return [row];
    if (change.deleted) return [];
    return change.done === undefined ? [row] : [withDone(row, change.done, change)];
  });
}

/** A save answered: a failure drops its mark, a success holds it. */
export function settleLocalRowChange(changes: LocalRowChanges, id: string, seq: number, ok: boolean): LocalRowChanges {
  const change = changes.get(id);
  // A later tap on the row has its own mark and its own save.
  if (!change || change.seq !== seq) return changes;
  const next = new Map(changes);
  if (ok) next.set(id, { ...change, settled: true });
  else next.delete(id);
  return next;
}

/** A new server list: it has every settled change, so their marks go. */
export function dropSettledRowChanges(changes: LocalRowChanges): LocalRowChanges {
  if (![...changes.values()].some((change) => change.settled)) return changes;
  return new Map([...changes].filter(([, change]) => !change.settled));
}

/**
 * A delete's save, settling its mark however it ends: `{ error }` brings
 * the row back, and so does a request that never arrives (offline, which
 * rejects). That one becomes `{ error: saveFailedMessage }` for the confirm
 * dialog to toast, as settleOptimisticAction does for a tick, instead of
 * reaching the error boundary; Next's redirect signals (an expired
 * session) are re-thrown. Pass `markDeleted(id)` first, so the row is gone
 * before the request leaves.
 */
export async function settleDelete<R extends { error?: string }>(
  settle: (ok: boolean) => void,
  request: Promise<R>,
  saveFailedMessage: string,
): Promise<R | { error: string }> {
  let result: R;
  try {
    result = await request;
  } catch (error) {
    settle(false);
    unstable_rethrow(error);
    return { error: saveFailedMessage };
  }
  settle(!result.error);
  return result;
}

/**
 * The local marks for `rows` (the server's list) and the two ways to make
 * one. Each returns `settle(ok)`, to call once the save has answered.
 */
export function useLocalRowChanges(rows: readonly unknown[]) {
  const [changes, setChanges] = useState<LocalRowChanges>(() => new Map());
  // A new server list retires the settled marks. Adjusted during render,
  // React's pattern for state that follows a prop, so a saved row never
  // shows one frame of its old state.
  const [seenRows, setSeenRows] = useState(rows);
  if (seenRows !== rows) {
    setSeenRows(rows);
    setChanges(dropSettledRowChanges);
  }
  const lastSeq = useRef(0);

  function mark(id: string, change: Omit<LocalRowChange, "seq">) {
    const seq = ++lastSeq.current;
    flushSync(() => setChanges((current) => new Map(current).set(id, { ...change, seq })));
    return function settle(ok: boolean) {
      setChanges((current) => settleLocalRowChange(current, id, seq, ok));
    };
  }

  return {
    changes,
    markDone: (id: string, done: boolean) => mark(id, { done }),
    markSkipped: (id: string, skipped: boolean) => mark(id, { done: skipped, skipped: true }),
    markDeleted: (id: string) => mark(id, { deleted: true }),
  };
}
