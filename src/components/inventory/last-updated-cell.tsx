"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { format } from "@/lib/i18n/format";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import type { HouseholdMemberOption, InventoryItemRow } from "@/components/inventory/inventory-table-utils";

// Renders the "Last updated" cell: a compact date plus, when resolvable, who
// last touched the item. The full sentence lives in a popover rather than a
// `title` attribute — a native tooltip only ever shows on hover, which
// touch devices don't have, so the "who" half would otherwise be
// unreachable on mobile. The popover opens on tap (and click/hover on
// desktop), and the trigger's `aria-label` also carries the full sentence
// so screen reader users get it immediately without needing to activate
// anything.
export function LastUpdatedCell({
  item,
  members,
  locale,
  dict,
}: {
  item: InventoryItemRow;
  members: HouseholdMemberOption[];
  locale: Locale;
  dict: Dictionary["inventory"];
}) {
  const dateFormat = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });
  const dateLabel = dateFormat.format(item.updatedAt);
  const updaterName = members.find((m) => m.userId === item.updatedByUserId)?.displayName;
  const fullLabel = updaterName
    ? format(dict.lastUpdatedWithUser, { date: dateLabel, name: updaterName })
    : format(dict.lastUpdatedNoUser, { date: dateLabel });

  // Nothing extra to disclose (no resolvable updater) — plain text, no
  // need for a tap target.
  if (!updaterName) {
    return <span className="block text-muted-foreground">{dateLabel}</span>;
  }

  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger
        openOnHover
        delay={300}
        aria-label={fullLabel}
        className="-m-2 block min-h-11 min-w-11 rounded p-2 text-left text-muted-foreground underline decoration-dotted decoration-from-font underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:pointer-fine:m-0 sm:pointer-fine:min-h-0 sm:pointer-fine:min-w-0 sm:pointer-fine:p-0"
      >
        {dateLabel}
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner side="top" align="start" sideOffset={6} className="z-50">
          <PopoverPrimitive.Popup className="max-w-64 rounded-md bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            {fullLabel}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
