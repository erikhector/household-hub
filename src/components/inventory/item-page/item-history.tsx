import { ChevronDown } from "lucide-react";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { describeStockEvent } from "@/lib/inventory/stock-history-view";

export type ItemHistoryEvent = { id: string; reason: string; delta: number; userName: string | null; createdAt: Date };

// GAP-66: "who changed the amount, and when", newest first. Collapsed by
// default (a native <details>, like the Profile's rare items: no JS, a full
// 44 px summary row per DESIGN.md M3) because it answers a question people
// ask occasionally. Nothing renders for an item with no history yet.
export function ItemHistory({
  events,
  unit,
  now,
  locale,
  dict,
}: {
  events: ItemHistoryEvent[];
  unit: string;
  now: Date;
  locale: string;
  dict: Dictionary["inventory"]["itemPage"];
}) {
  if (events.length === 0) return null;
  return (
    <details className="group list-bleed rounded-md border">
      <summary className="touch-target flex cursor-pointer list-none items-center justify-between gap-2 rounded-md px-4 py-3 font-heading text-lg font-semibold [&::-webkit-details-marker]:hidden">
        {dict.historyTitle}
        <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <ul className="flex flex-col divide-y border-t text-sm">
        {events.map((event) => (
          <li key={event.id} className="px-4 py-2">
            {describeStockEvent(event, { unit, now, locale, dict })}
          </li>
        ))}
      </ul>
    </details>
  );
}
