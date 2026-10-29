"use client";

import { SHOPPING_LIST_CACHE_NAME } from "@/lib/cookie-inventory";
import { clearQueuedTicks } from "@/lib/shopping/offline-tick-queue-store";

// UX-36: everything the shopping list keeps on the device for offline use —
// the service worker's copy of the list page and the queue of ticks waiting
// to sync. Logging out wipes both, so the next person to use this browser
// can't open the previous household's list or push its ticks.
export async function clearOfflineShoppingData() {
  clearQueuedTicks();
  try {
    await caches.delete(SHOPPING_LIST_CACHE_NAME);
  } catch {
    // No Cache Storage (older browsers, private windows): nothing to clear.
  }
}
