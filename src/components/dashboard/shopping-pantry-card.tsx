// UX-HOME-2: one card for the shopping list and the pantry, replacing the
// overview's three stat cards ("Low stock items", "Shopping lists", "Total
// items tracked"). The design proposal's evidence: the low-stock card's
// headline was a "0" in big type beside a small red "1 out of stock", the
// open list was the seventh block on a phone, and a count of pantry rows had
// no task behind it.
//
// - The list row is the biggest target on the page: the open list (or, with
//   several, the lists page) with how much is left to buy. With none it's
//   "Start a list".
// - Out and low stock are one warning, worded as the problem ("1 out, 4
//   running low"), never a bare 0, with "Add N" from the shopping list's own
//   add-low-stock action. It links to the inventory filtered to them (UX-71).
// - "Use soon" names the expiring items instead of counting them, each a
//   chip to its item page.
//
// Server-rendered from what page.tsx already loads; only the Add button is
// a Client Component.

import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight, CircleCheck, ShoppingCart, TriangleAlert } from "lucide-react";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AddLowStockButton } from "@/components/dashboard/home-add-buttons";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { PantrySummary, UseSoonItem } from "@/lib/home-summary";
import { cn } from "@/lib/utils";

export function ShoppingPantryCard({
  lists,
  pendingCount,
  pantry,
  hasItems,
  lowHref,
  target,
  useSoon,
  moreUseSoonCount,
  laterDayFormat,
  dict,
  shoppingDict,
  saveFailedToast,
  addToList,
}: {
  /** The active lists (only their ids and names are read). */
  lists: { id: string; name: string }[];
  /** Rows still to buy across them. */
  pendingCount: number;
  pantry: PantrySummary;
  /** False for an empty pantry, which has no stock to warn about yet. */
  hasItems: boolean;
  lowHref: string;
  /** Where "Add N" puts the items (pickTargetList); null with no active list. */
  target: { id: string; name: string } | null;
  useSoon: UseSoonItem[];
  moreUseSoonCount: number;
  /** Names a date past tomorrow ("Mon"), read as a UTC date (pickUseSoon). */
  laterDayFormat: Intl.DateTimeFormat;
  dict: Dictionary["dashboard"]["pantry"];
  shoppingDict: Pick<Dictionary["shoppingList"], "addLowStockAddedToast" | "addLowStockNoneToast">;
  saveFailedToast: string;
  /** Home's one-tap "Add to list" (HomeAddToList), shown in the header beside
   * the list it fills; absent with no active list. */
  addToList?: ReactNode;
}) {
  const onlyList = lists.length === 1 ? lists[0] : null;
  const needsRestock = pantry.outCount + pantry.lowCount;
  const problem = [
    pantry.outCount > 0 ? format(plural(pantry.outCount, dict.out), { count: pantry.outCount }) : null,
    pantry.lowCount > 0 ? format(plural(pantry.lowCount, dict.low), { count: pantry.lowCount }) : null,
  ]
    .filter(Boolean)
    .join(", ");
  const dayLabel = (item: UseSoonItem) =>
    item.day === "expired"
      ? dict.dayExpired
      : item.day === "today"
        ? dict.dayToday
        : item.day === "tomorrow"
          ? dict.dayTomorrow
          : laterDayFormat.format(item.expiresAt);

  return (
    <Card>
      {/* A wrapping row rather than CardHeader's title/action grid: at 200%
          text in Swedish "Add to list" no longer fits beside the title and
          drops below it, where the grid kept it beside the title and the
          card's overflow-hidden cut it off (M9). items-center lines the title
          up with the 44 px phone button. From sm the 32 px button takes -my-1,
          so it centres on the 24 px title line without making the header
          taller than Today's: the two cards' headings stay level side by
          side (e2e/overview.spec.ts). */}
      <CardHeader className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <CardTitle>
          <h2 className="font-heading text-base font-semibold text-foreground">{dict.title}</h2>
        </CardTitle>
        {addToList && <CardAction className="max-w-full sm:-my-1">{addToList}</CardAction>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {lists.length === 0 ? (
          <Link
            href="/dashboard/shopping-list"
            className="flex min-h-16 items-center gap-3 rounded-lg bg-muted/60 p-3 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-chart-2/15 text-chart-2">
              <ShoppingCart className="size-5" aria-hidden />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium">{dict.startList}</span>
              <span className="text-sm text-muted-foreground">{dict.startListHint}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        ) : (
          <Link
            href={onlyList ? `/dashboard/shopping-list/${onlyList.id}` : "/dashboard/shopping-list"}
            className="flex min-h-16 items-center gap-3 rounded-lg bg-muted/60 p-3 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <span className="font-heading text-3xl leading-none font-bold text-foreground tabular-nums">
              {pendingCount}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="line-clamp-2 font-medium break-words">
                {onlyList
                  ? onlyList.name
                  : format(plural(lists.length, dict.activeLists), { count: lists.length })}
              </span>
              <span className="text-sm text-muted-foreground">{plural(pendingCount, dict.itemsToBuy)}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        )}

        {hasItems &&
          (needsRestock === 0 ? (
            <p className="flex items-center gap-2 text-sm font-medium text-success">
              <CircleCheck className="size-4 shrink-0" aria-hidden />
              {dict.allStockedUp}
            </p>
          ) : (
            // Status on a tint of itself, with an icon and words (never
            // colour alone): destructive once anything is out, else warning.
            <div
              className={cn(
                // flex-wrap + the label's min width: with a long (Swedish)
                // summary the "Add N" button drops to its own line instead of
                // squeezing the label into a column that strands one word.
                "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg py-1.5 pr-1.5 pl-3",
                pantry.outCount > 0 ? "bg-destructive/10 dark:bg-destructive/20" : "bg-warning/10 dark:bg-warning/20",
              )}
            >
              <TriangleAlert
                className={cn("size-4 shrink-0", pantry.outCount > 0 ? "text-destructive" : "text-warning")}
                aria-hidden
              />
              <Link
                href={lowHref}
                className="flex min-h-9 min-w-44 flex-1 flex-col justify-center rounded-md text-pretty hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none max-sm:min-h-11 pointer-coarse:min-h-11"
              >
                <span className="text-sm font-medium text-foreground">{problem}</span>
                {pantry.onListCount > 0 && (
                  <span className="text-sm text-muted-foreground">
                    {format(plural(pantry.onListCount, dict.alreadyOnList), { count: pantry.onListCount })}
                  </span>
                )}
              </Link>
              {target && pantry.toAddCount > 0 && (
                <AddLowStockButton
                  listId={target.id}
                  label={format(dict.addLowStock, { count: pantry.toAddCount })}
                  ariaLabel={format(plural(pantry.toAddCount, dict.addLowStockAriaLabel), {
                    count: pantry.toAddCount,
                    list: target.name,
                  })}
                  dict={{
                    addedToast: shoppingDict.addLowStockAddedToast,
                    noneToast: shoppingDict.addLowStockNoneToast,
                    saveFailedToast,
                  }}
                />
              )}
            </div>
          ))}

        {useSoon.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">{dict.useSoon}</h3>
            <ul className="flex flex-wrap gap-2">
              {useSoon.map((item) => (
                <li key={item.id} className="max-w-full">
                  <Link
                    href={`/dashboard/inventory/items/${item.id}`}
                    className="inline-flex min-h-8 max-w-full items-center gap-1 rounded-full border bg-background px-3 text-sm hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none max-sm:min-h-11 pointer-coarse:min-h-11"
                  >
                    <span className="truncate font-medium">{item.name}</span>
                    <span className={cn("shrink-0", item.day === "expired" ? "text-destructive" : "text-muted-foreground")}>
                      · {dayLabel(item)}
                    </span>
                  </Link>
                </li>
              ))}
              {moreUseSoonCount > 0 && (
                <li>
                  <Link
                    href="/dashboard/inventory?status=expiring"
                    className="inline-flex min-h-8 items-center rounded-full px-3 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none max-sm:min-h-11 pointer-coarse:min-h-11"
                  >
                    {format(plural(moreUseSoonCount, dict.moreUseSoon), { count: moreUseSoonCount })}
                  </Link>
                </li>
              )}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
