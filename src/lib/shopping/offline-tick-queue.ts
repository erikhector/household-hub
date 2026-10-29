// UX-36: the shopping list's offline tick queue. In a dead zone a tick can't
// be saved, so it waits here (one entry per row) and is replayed when the
// connection is back. Ticks only: adds and price edits need id/merge rules a
// tick doesn't (see BACKLOG.md), so they stay online-only.
//
// Conflict rule: last write wins per row. A row ticked then unticked offline
// is one entry holding the last wish, and an entry that ends up matching what
// the server already has is dropped, so there is nothing to replay. A row
// deleted meanwhile is skipped silently when the replay finds it gone
// (replayTickAction answers `{}` for it).
//
// The pure half lives here so it can be unit tested without a browser; the
// storage half is offline-tick-queue-store.ts.

export type QueuedTick = {
  itemId: string;
  /** What the person wanted the row to be: ticked (true) or not. */
  purchased: boolean;
};

export type TickQueue = readonly QueuedTick[];

export const NO_QUEUED_TICKS: TickQueue = [];

/**
 * Records a tap made offline: the row should end up `purchased`. Replaces the
 * row's earlier entry (last write wins), and drops it when the server's own
 * copy already agrees, since replaying it would change nothing.
 */
export function queueTick(
  queue: TickQueue,
  itemId: string,
  purchased: boolean,
  serverPurchased: boolean,
): TickQueue {
  const rest = queue.filter((entry) => entry.itemId !== itemId);
  return purchased === serverPurchased ? rest : [...rest, { itemId, purchased }];
}

/** Removes a row's entry once it has been saved (or skipped). */
export function dropTick(queue: TickQueue, itemId: string): TickQueue {
  return queue.some((entry) => entry.itemId === itemId)
    ? queue.filter((entry) => entry.itemId !== itemId)
    : queue;
}

/** What the queue says a row should show, if it has an entry. */
export function queuedPurchased(queue: TickQueue, itemId: string): boolean | undefined {
  return queue.find((entry) => entry.itemId === itemId)?.purchased;
}

/**
 * Reads the stored JSON back, ignoring anything that isn't a well-formed
 * entry (a hand-edited or older value must never break the list).
 */
export function parseQueue(raw: string | null): TickQueue {
  if (!raw) return NO_QUEUED_TICKS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return NO_QUEUED_TICKS;
    const seen = new Set<string>();
    const queue: QueuedTick[] = [];
    for (const entry of parsed) {
      if (
        entry &&
        typeof entry === "object" &&
        typeof entry.itemId === "string" &&
        entry.itemId !== "" &&
        typeof entry.purchased === "boolean" &&
        !seen.has(entry.itemId)
      ) {
        seen.add(entry.itemId);
        queue.push({ itemId: entry.itemId, purchased: entry.purchased });
      }
    }
    return queue.length > 0 ? queue : NO_QUEUED_TICKS;
  } catch {
    return NO_QUEUED_TICKS;
  }
}
