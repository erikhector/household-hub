"use client";

import { CloudOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useUnitLabel } from "@/components/units-provider";
import type { ShoppingListDict } from "@/components/shopping/shopping-list-types";
import type { QueuedAdd } from "@/lib/shopping/offline-tick-queue";
import { formatShoppingItemLabel } from "@/lib/shopping-list-text";

/**
 * UX-36b: the rows typed into the smart add line with no signal, shown at
 * once so the add visibly landed, until the replay saves them and the real
 * rows take their place. Read-only on purpose: with no server id there is
 * nothing to tick, edit or price yet (money stays online, UX-36), and the
 * dashed border and "Waiting" badge (a word, not colour alone) tell them
 * apart from saved rows. Same padding as an active list's row, so the real
 * row that replaces one takes the same room.
 */
export function OfflinePendingAdds({
  adds,
  dict,
  locale,
}: {
  adds: QueuedAdd[];
  dict: ShoppingListDict;
  locale: string;
}) {
  const unitLabel = useUnitLabel();
  if (adds.length === 0) return null;
  return (
    <ul aria-label={dict.offlineAddsLabel} className="flex flex-col gap-2">
      {adds.map(({ key, row }) => (
        <li
          key={key}
          className="flex items-center gap-3 rounded-md border border-dashed px-3 py-3 text-muted-foreground max-sm:min-h-11"
        >
          <CloudOff className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 break-words">
            {formatShoppingItemLabel({ name: row.name, quantity: row.quantity, unit: row.unit ?? "pcs" }, unitLabel, locale)}
          </span>
          <Badge variant="outline" className="shrink-0">
            {dict.offlineAddBadge}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
