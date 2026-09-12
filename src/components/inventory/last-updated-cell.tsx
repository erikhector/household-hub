"use client";

import { format } from "@/lib/i18n/format";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import type { HouseholdMemberOption, InventoryItemRow } from "@/components/inventory/inventory-table-utils";

// Renders the "Last updated" cell: a compact date plus, when resolvable, who
// last touched the item — with the full sentence in a tooltip since the
// column itself only has room for the date.
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

  return (
    <span className="block text-muted-foreground" title={fullLabel}>
      {dateLabel}
    </span>
  );
}
