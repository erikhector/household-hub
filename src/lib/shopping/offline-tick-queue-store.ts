"use client";

import { unstable_rethrow } from "next/navigation";
import { SHOPPING_TICK_QUEUE_STORAGE_KEY } from "@/lib/cookie-inventory";
import { dropTick, NO_QUEUED_TICKS, parseQueue, type TickQueue } from "@/lib/shopping/offline-tick-queue";

// UX-36: the browser-side half of the offline tick queue — a tiny external
// store over localStorage, read with useSyncExternalStore so the chip and the
// rows follow it (and so server rendering, which sees no queue, matches the
// first client render). The key is listed in src/lib/cookie-inventory.ts.
//
// Every access is wrapped: localStorage can throw (private windows, blocked
// site data). The in-memory copy is the source of truth for this page, so a
// failed write only costs the queue surviving a reload.

let current: TickQueue | null = null;
const listeners = new Set<() => void>();

function readStorage(): TickQueue {
  try {
    return parseQueue(window.localStorage.getItem(SHOPPING_TICK_QUEUE_STORAGE_KEY));
  } catch {
    return NO_QUEUED_TICKS;
  }
}

function writeStorage(queue: TickQueue) {
  try {
    if (queue.length === 0) window.localStorage.removeItem(SHOPPING_TICK_QUEUE_STORAGE_KEY);
    else window.localStorage.setItem(SHOPPING_TICK_QUEUE_STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // Best effort, see above.
  }
}

function notify() {
  listeners.forEach((listener) => listener());
}

export function getQueuedTicks(): TickQueue {
  current ??= readStorage();
  return current;
}

export function setQueuedTicks(queue: TickQueue) {
  current = queue.length === 0 ? NO_QUEUED_TICKS : queue;
  writeStorage(current);
  notify();
}

/** Called on logout: the next person on this device must not inherit it. */
export function clearQueuedTicks() {
  setQueuedTicks(NO_QUEUED_TICKS);
}

export function subscribeQueuedTicks(listener: () => void) {
  listeners.add(listener);
  // Another tab ticking offline (or replaying) changes the same storage.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== SHOPPING_TICK_QUEUE_STORAGE_KEY) return;
    current = readStorage();
    notify();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export const getServerQueuedTicks = (): TickQueue => NO_QUEUED_TICKS;

type ReplayResult = { error?: string };

let replaying = false;

/**
 * Saves the queued ticks in order, dropping each from the queue once the
 * server has answered it. Stops at the first request that never arrives (the
 * connection dropped again), leaving that entry and the rest queued for the
 * next `online`. An answer carrying an error is dropped too, so one bad row
 * can't block the ones behind it; `onFailed` reports it. Only one replay runs
 * at a time (the online event, a mount and a new tick can all ask for one).
 * Resolves true when at least one entry was settled.
 */
export async function replayQueuedTicks(
  replay: (tick: { itemId: string; purchased: boolean }) => Promise<ReplayResult>,
  onFailed: () => void,
): Promise<boolean> {
  if (replaying) return false;
  replaying = true;
  let settled = false;
  try {
    // Repeats while taps made during a pass left something new behind it.
    for (let more = true; more; ) {
      more = false;
      for (const tick of getQueuedTicks()) {
        let result: ReplayResult;
        try {
          result = await replay(tick);
        } catch (error) {
          // A redirect or not-found signal (an expired session) belongs to
          // the router; anything else is the network.
          unstable_rethrow(error);
          return settled;
        }
        // A tap on this row while its save was on the way replaced the
        // entry; that newer wish still has to be sent, so only an unchanged
        // one goes.
        const latest = getQueuedTicks().find((entry) => entry.itemId === tick.itemId);
        if (latest?.purchased === tick.purchased) setQueuedTicks(dropTick(getQueuedTicks(), tick.itemId));
        else more = true;
        settled = true;
        if (result.error) onFailed();
      }
    }
  } finally {
    replaying = false;
  }
  return settled;
}
