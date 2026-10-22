// The one prev/next/"this period" switcher for anything paged by a calendar
// period: the household and personal budgets (months) and the meal planner
// (weeks). UX-53: the two used to differ (bare chevrons around a large
// centred heading vs. small outlined square buttons beside a small date), so
// the same gesture looked different on neighbouring screens. Now it is one
// component, so the placement, size and accessible names can't drift.
//
// `‹  October 2026  ›`: ghost arrows flanking the period as the strip's
// headline, with the jump back ("This month" / "This week") under the name
// only once you're elsewhere, since on the current period it would be a link
// that did nothing. The arrows and the jump are real links (not a Button
// rendering a Link, which Base UI announces as a button), because paging is a
// full server-rendered navigation driven by the URL alone, no client state.

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PeriodSwitcherDict = {
  previous: string;
  next: string;
  /** "This month" / "This week". */
  current: string;
};

export function PeriodSwitcher({
  label,
  prevHref,
  nextHref,
  currentHref,
  isCurrent,
  dict,
  className,
}: {
  /** The period being looked at, already formatted in the viewer's locale. */
  label: string;
  prevHref: string;
  nextHref: string;
  /** Where "This month" / "This week" goes: the page without its period param. */
  currentHref: string;
  /** Decided by the server from its own "today", so the server render and
   * hydration can't disagree around midnight. */
  isCurrent: boolean;
  dict: PeriodSwitcherDict;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      <Link
        href={prevHref}
        aria-label={dict.previous}
        className={buttonVariants({ variant: "ghost", size: "icon-lg" })}
      >
        <ChevronLeft className="size-5" />
      </Link>
      <div className="flex min-w-0 flex-col items-center">
        <p className="truncate font-heading text-lg font-semibold">{label}</p>
        {!isCurrent && (
          <Link
            href={currentHref}
            className="touch-target inline-flex items-center text-sm font-medium text-primary hover:underline"
          >
            {dict.current}
          </Link>
        )}
      </div>
      <Link
        href={nextHref}
        aria-label={dict.next}
        className={buttonVariants({ variant: "ghost", size: "icon-lg" })}
      >
        <ChevronRight className="size-5" />
      </Link>
    </div>
  );
}
