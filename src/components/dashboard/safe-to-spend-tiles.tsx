// UX-HOME-4: both safe-to-spend numbers side by side. Home used to show the
// household's as a small row inside Today and the user's own as a large
// card with its full breakdown further down, so neither page put the two
// next to each other. Now they are two equal tiles, each a link to its
// budget, with a status word and icon beside the colour (DESIGN.md: never
// colour alone). The breakdown lives on Personal budget, where it already
// is.
//
// - No personal budget yet: the "You" tile is a "Set up" link instead.
// - A budget with no income (UX-154, status "unset"): the tile has no number,
//   since a 0.00 in green would vouch for a budget nobody has set up. It
//   reads "Budget not set up yet" in muted text and links to adding income.
// - No household budget: no Household tile. The card itself always shows,
//   since the "You" tile is either a number or the way to set one up.
// - A balance with another member, either way: the same lines the budget
//   pages show (HouseholdDebtsList), under the tiles.

import Link from "next/link";
import type { ComponentType } from "react";
import { ChevronRight, CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HouseholdDebtsList, type HouseholdDebtsDict } from "@/components/budget/household-debts-list";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { HouseholdDebt, SafeToSpendStatus } from "@/lib/safe-to-spend-calc";
import { cn } from "@/lib/utils";

export type SafeToSpendTile = { amount: string; status: SafeToSpendStatus };

type NumberStatus = Exclude<SafeToSpendStatus, "unset">;

const STATUS_COLOR: Record<NumberStatus, string> = {
  healthy: "text-success",
  tight: "text-warning",
  over: "text-destructive",
};

const STATUS_ICON: Record<NumberStatus, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  healthy: CircleCheck,
  tight: TriangleAlert,
  over: CircleAlert,
};

const TILE =
  "flex min-h-24 min-w-0 flex-col gap-1 rounded-lg bg-muted/60 p-3 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

function Tile({
  href,
  incomeHref,
  label,
  tile,
  dict,
}: {
  href: string;
  /** Where "unset" sends you: the budget's Transactions tab, to log income. */
  incomeHref: string;
  label: string;
  tile: SafeToSpendTile;
  dict: Dictionary["dashboard"]["money"];
}) {
  if (tile.status === "unset") {
    return (
      <Link href={incomeHref} className={TILE}>
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="mt-auto flex items-center gap-1 text-sm font-medium text-muted-foreground">
          {dict.notSetUp}
          <ChevronRight className="size-4 shrink-0" aria-hidden />
        </span>
      </Link>
    );
  }
  const Icon = STATUS_ICON[tile.status];
  return (
    <Link href={href} className={TILE}>
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-heading text-2xl leading-tight font-bold break-words tabular-nums",
          STATUS_COLOR[tile.status],
        )}
      >
        {tile.amount}
      </span>
      <span className={cn("mt-auto flex items-center gap-1 text-sm font-medium", STATUS_COLOR[tile.status])}>
        <Icon className="size-4 shrink-0" aria-hidden />
        {dict.status[tile.status]}
      </span>
    </Link>
  );
}

export function SafeToSpendTiles({
  personal,
  household,
  debts,
  showHouseholdName,
  numberFormat,
  dict,
  debtsDict,
}: {
  /** Null until the user's personal budget has categories. */
  personal: SafeToSpendTile | null;
  /** Null until the household budget has categories. */
  household: SafeToSpendTile | null;
  debts: HouseholdDebt[];
  showHouseholdName: boolean;
  numberFormat: Intl.NumberFormat;
  dict: Dictionary["dashboard"]["money"];
  debtsDict: HouseholdDebtsDict;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="font-heading text-base font-semibold text-foreground">{dict.title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          {personal ? (
            <Tile
              href="/dashboard/personal-budget"
              incomeHref="/dashboard/personal-budget?tab=transactions"
              label={dict.you}
              tile={personal}
              dict={dict}
            />
          ) : (
            <Link href="/dashboard/personal-budget" className={TILE} aria-label={dict.setUpAriaLabel}>
              <span className="text-sm text-muted-foreground">{dict.you}</span>
              <span className="mt-auto flex items-center gap-1 text-sm font-medium text-primary">
                {dict.setUp}
                <ChevronRight className="size-4 shrink-0" aria-hidden />
              </span>
            </Link>
          )}
          {household && (
            <Tile
              href="/dashboard/budget"
              incomeHref="/dashboard/budget?tab=transactions"
              label={dict.household}
              tile={household}
              dict={dict}
            />
          )}
        </div>
        <HouseholdDebtsList
          debts={debts}
          showHouseholdName={showHouseholdName}
          numberFormat={numberFormat}
          dict={debtsDict}
        />
      </CardContent>
    </Card>
  );
}
