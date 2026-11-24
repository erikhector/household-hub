// UX-36: the shopping list's offline tick queue. In a dead zone a tick can't
// be saved, so it waits here (one entry per row) and is replayed when the
// connection is back. UX-36b put adds from the smart add line in the same
// queue (the names here still say "tick", and the stored key is unchanged,
// so a queue left from before keeps working). Price edits, item edits and
// deletes stay online-only: money stays online (see PRODUCT.md).
//
// Conflict rule: last write wins per row. A row ticked then unticked offline
// is one entry holding the last wish, and an entry that ends up matching what
// the server already has is dropped, so there is nothing to replay. A row
// deleted meanwhile is skipped silently when the replay finds it gone
// (replayTickAction answers `{}` for it).
//
// Adds have no merge rule of their own: each typed row is one entry, kept in
// the order typed, and is replayed through smartAddShoppingListItemsAction,
// whose "already on the list" dedupe makes the same name added on two phones
// end as one row, exactly as two online adds do. No client id reaches the
// server; an entry's `key` only names it inside this queue. An add whose list
// was completed or deleted meanwhile comes back with an error and is dropped
// with a toast naming it.
//
// The pure half lives here so it can be unit tested without a browser; the
// storage half is offline-tick-queue-store.ts.

import type { SmartAddRow } from "@/lib/shopping/smart-add-suggestions";

type QueuedTick = {
  itemId: string;
  /** What the person wanted the row to be: ticked (true) or not. */
  purchased: boolean;
};

/** One row typed into the smart add line while offline (UX-36b). */
export type QueuedAdd = {
  kind: "add";
  /** Local only: tells this entry apart from the same name typed twice. */
  key: string;
  listId: string;
  row: SmartAddRow;
};

export type QueuedEntry = QueuedTick | QueuedAdd;

export type TickQueue = readonly QueuedEntry[];

export const NO_QUEUED_TICKS: TickQueue = [];

// Ticks carry no `kind`: that is the shape UX-36 stored, kept so an older
// queue still reads.
export function isTick(entry: QueuedEntry): entry is QueuedTick {
  return !("kind" in entry);
}

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
  const rest = queue.filter((entry) => !isTick(entry) || entry.itemId !== itemId);
  return purchased === serverPurchased ? rest : [...rest, { itemId, purchased }];
}

/** Removes a row's entry once it has been saved (or skipped). */
export function dropTick(queue: TickQueue, itemId: string): TickQueue {
  return queue.some((entry) => isTick(entry) && entry.itemId === itemId)
    ? queue.filter((entry) => !isTick(entry) || entry.itemId !== itemId)
    : queue;
}

/** What the queue says a row should show, if it has an entry. */
export function queuedPurchased(queue: TickQueue, itemId: string): boolean | undefined {
  return queue.find((entry): entry is QueuedTick => isTick(entry) && entry.itemId === itemId)?.purchased;
}

/**
 * Records rows typed into the smart add line offline, after everything
 * already waiting, so the replay keeps the order. `newKey` makes each
 * entry's local key (a parameter so tests can pass predictable ones).
 */
export function queueAdds(
  queue: TickQueue,
  listId: string,
  rows: readonly SmartAddRow[],
  newKey: () => string,
): TickQueue {
  return [...queue, ...rows.map((row): QueuedAdd => ({ kind: "add", key: newKey(), listId, row }))];
}

/** Removes an add once the server has answered it. */
export function dropAdd(queue: TickQueue, key: string): TickQueue {
  return queue.some((entry) => !isTick(entry) && entry.key === key)
    ? queue.filter((entry) => isTick(entry) || entry.key !== key)
    : queue;
}

/** The adds waiting for one list, in the order they were typed. */
export function queuedAdds(queue: TickQueue, listId: string): QueuedAdd[] {
  return queue.filter((entry): entry is QueuedAdd => !isTick(entry) && entry.listId === listId);
}

// Rebuilt field by field, so nothing unexpected in storage is ever sent to
// the server (which validates it again anyway).
function parseAdd(entry: Record<string, unknown>): QueuedAdd | null {
  const row = entry.row;
  if (
    typeof entry.key !== "string" ||
    entry.key === "" ||
    typeof entry.listId !== "string" ||
    entry.listId === "" ||
    !row ||
    typeof row !== "object"
  ) {
    return null;
  }
  const { name, quantity, unit, inventoryItemId } = row as Record<string, unknown>;
  if (
    typeof name !== "string" ||
    name.trim() === "" ||
    typeof quantity !== "number" ||
    !Number.isFinite(quantity) ||
    (unit !== undefined && typeof unit !== "string") ||
    (inventoryItemId !== undefined && typeof inventoryItemId !== "string")
  ) {
    return null;
  }
  const parsed: SmartAddRow = { name, quantity };
  if (unit !== undefined) parsed.unit = unit;
  if (inventoryItemId !== undefined) parsed.inventoryItemId = inventoryItemId;
  return { kind: "add", key: entry.key, listId: entry.listId, row: parsed };
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
    const queue: QueuedEntry[] = [];
    for (const entry of parsed) {
      if (entry && typeof entry === "object" && entry.kind === "add") {
        const add = parseAdd(entry);
        if (add && !seen.has(`add:${add.key}`)) {
          seen.add(`add:${add.key}`);
          queue.push(add);
        }
      } else if (
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
