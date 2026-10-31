// UX-HOME-2/4: the pure parts of the Home page (src/app/dashboard/page.tsx).
// The page loads rows; these turn them into what the Shopping & pantry card
// and the setup strip say, so the wording rules ("1 out, 4 running low",
// never a bare 0; which list "Add N" fills; when setup shrinks) are tested
// without a database.

import { getStockStatus } from "@/lib/stock-status";
import { getExpiryStatus } from "@/lib/inventory/expiry";
import { localDayNumber } from "@/app/dashboard/tasks/recurrence";

export type PantrySummary = {
  outCount: number;
  /** Low but not out, the inventory filter's own meaning of "low" (UX-71). */
  lowCount: number;
  /** Of the out and low ones, how many a pending list row already restocks. */
  onListCount: number;
  /** What the shopping list's "Add low stock" would add: out or low, not on a list yet. */
  toAddCount: number;
};

export function summarizePantry(
  items: readonly { id: string; quantity: number; lowStockThreshold: number }[],
  onListItemIds: ReadonlySet<string | null>,
): PantrySummary {
  let outCount = 0;
  let lowCount = 0;
  let onListCount = 0;
  for (const item of items) {
    const status = getStockStatus(item.quantity, item.lowStockThreshold);
    if (status === "in") continue;
    if (status === "out") outCount++;
    else lowCount++;
    if (onListItemIds.has(item.id)) onListCount++;
  }
  return { outCount, lowCount, onListCount, toAddCount: outCount + lowCount - onListCount };
}

/**
 * The list Home adds to ("Add N", "Add to list", missing ingredients): the
 * household's default "Next shop" when it is active, else the newest active
 * list. The same order the command palette's `?add=1` redirect uses
 * (src/app/dashboard/shopping-list/page.tsx), so both land on one list.
 */
export function pickTargetList<T extends { isDefault: boolean; createdAt: Date }>(lists: readonly T[]): T | null {
  let best: T | null = null;
  for (const list of lists) {
    if (
      !best ||
      (list.isDefault && !best.isDefault) ||
      (list.isDefault === best.isDefault && list.createdAt.getTime() > best.createdAt.getTime())
    ) {
      best = list;
    }
  }
  return best;
}

export type UseSoonDay = "expired" | "today" | "tomorrow" | "later";

export type UseSoonItem = { id: string; name: string; expiresAt: Date; day: UseSoonDay };

/**
 * The items to eat first, soonest (and anything already past its date)
 * first: in stock and inside the expiry warning window, the same rule as
 * the inventory's "Expiring" filter. `day` names the date in the user's own
 * time zone, so "tomorrow" means their tomorrow, not the server's.
 */
export function pickUseSoon(
  items: readonly { id: string; name: string; quantity: number; expiresAt: Date | null }[],
  now: Date,
  timeZone: string,
  limit: number,
): { shown: UseSoonItem[]; moreCount: number } {
  const today = localDayNumber(now, timeZone);
  const soon = items
    .filter((item): item is typeof item & { expiresAt: Date } =>
      item.quantity > 0 && getExpiryStatus(item.expiresAt, now.getTime()) !== null,
    )
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  const shown = soon.slice(0, limit).map((item) => {
    const offset = localDayNumber(item.expiresAt, timeZone) - today;
    const day: UseSoonDay =
      item.expiresAt.getTime() < now.getTime() ? "expired" : offset <= 0 ? "today" : offset === 1 ? "tomorrow" : "later";
    return { id: item.id, name: item.name, expiresAt: item.expiresAt, day };
  });
  return { shown, moreCount: soon.length - shown.length };
}

/**
 * UX-HOME-4: setup is the one job in a household's first days, so the full
 * card shows while at most this many steps are finished. After that it
 * shrinks to a one-line strip naming the next step.
 */
export const SETUP_FULL_CARD_MAX_DONE = 2;
