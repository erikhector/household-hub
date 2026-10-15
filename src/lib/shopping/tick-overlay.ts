// UX-37: the shopping list's ticks ahead of the server, one entry per row
// with a save in flight or just saved. This replaces a `useOptimistic` set
// in one shared transition: React 19 entangles concurrent async
// transitions, so a failed tick's optimistic state wasn't dropped until
// *every* tick in flight had settled, and the row sat in "In the cart"
// after its save had failed (DESIGN.md M5 wants that rollback visible at
// once). Here each tick settles on its own.
//
// An entry holds what the row should show (`expected`) and how many of its
// toggles are still on their way. A quick re-tap before the server answers
// flips `expected` again and sends a second toggle, as before. A failed
// toggle never happened, so it flips `expected` back. Once nothing is in
// flight, the entry goes straight away if the current server list already
// agrees with it (a failure, since the server never changed, or a success
// whose revalidated list rendered before the save settled). Otherwise it
// holds until the next server list, so a saved row doesn't flicker back for
// the moment in between, and that next list wins whatever it says: it
// already includes the settled toggle, and anything that disagrees with it
// (another member unticking the row) is the truth, not something to hide.

export type TickEntry = { expected: boolean; inFlight: number };
export type TickOverlay = ReadonlyMap<string, TickEntry>;

export const NO_TICKS: TickOverlay = new Map();

/** What a row shows: the overlay's expectation, else the server's value. */
export function shownPurchased(overlay: TickOverlay, id: string, serverPurchased: boolean): boolean {
  return overlay.get(id)?.expected ?? serverPurchased;
}

/** A tap: flip what the row shows and count one more toggle in flight. */
export function tickStarted(overlay: TickOverlay, id: string, serverPurchased: boolean): TickOverlay {
  const entry = overlay.get(id);
  const next = new Map(overlay);
  next.set(id, {
    expected: !(entry?.expected ?? serverPurchased),
    inFlight: (entry?.inFlight ?? 0) + 1,
  });
  return next;
}

/** One toggle answered (`ok`) or failed; drops the entry once it's moot. */
export function tickSettled(
  overlay: TickOverlay,
  id: string,
  ok: boolean,
  serverPurchased: boolean,
): TickOverlay {
  const entry = overlay.get(id);
  if (!entry) return overlay;
  const settled = {
    expected: ok ? entry.expected : !entry.expected,
    inFlight: Math.max(0, entry.inFlight - 1),
  };
  const next = new Map(overlay);
  if (settled.inFlight === 0 && settled.expected === serverPurchased) next.delete(id);
  else next.set(id, settled);
  return next;
}

/**
 * The server's rows changed: drop every settled entry. A new list after a
 * toggle settled already reflects it, so it's authoritative even where it
 * disagrees; only entries with a save still on its way are kept.
 */
export function reconcileTicks(
  overlay: TickOverlay,
  items: ReadonlyArray<{ id: string; purchased: boolean }>,
): TickOverlay {
  if (overlay.size === 0) return overlay;
  const ids = new Set(items.map((item) => item.id));
  let next: Map<string, TickEntry> | null = null;
  for (const [id, entry] of overlay) {
    // In flight: keep, unless the row is gone (deleted elsewhere).
    if (entry.inFlight > 0 && ids.has(id)) continue;
    next ??= new Map(overlay);
    next.delete(id);
  }
  return next ?? overlay;
}

/** Any toggle still on its way (finishing the trip waits for these). */
export function hasTicksInFlight(overlay: TickOverlay): boolean {
  for (const entry of overlay.values()) if (entry.inFlight > 0) return true;
  return false;
}
