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
  sublabel,
  prevHref,
  nextHref,
  currentHref,
  isCurrent,
  dict,
  className,
}: {
  /** The period being looked at, already formatted in the viewer's locale. */
  label: string;
  /** UX-134: the period's dates, when its name alone doesn't say them (a
   * budget month that starts on payday). */
  sublabel?: string | null;
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
        className={cn(buttonVariants({ variant: "ghost", size: "icon-lg" }), "shrink-0 max-sm:size-[44px] pointer-coarse:size-[44px]")}
      >
        <ChevronLeft className="size-5" />
      </Link>
      <div className="flex flex-col items-center">
        {/* UX-149: the period is the headline, so it wraps (to two lines at
            200% text) instead of truncating. Its column has no min-w-0, so it
            never gets narrower than its longest word. The arrows are shrink-0 and a
            fixed 44 px (not rem, which doubles at 200% text and left no room
            for the label), so the row squeezes neither. */}
        <p className="text-balance text-center font-heading text-lg font-semibold">{label}</p>
        {sublabel && <p className="text-balance text-center text-sm text-muted-foreground">{sublabel}</p>}
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
        className={cn(buttonVariants({ variant: "ghost", size: "icon-lg" }), "shrink-0 max-sm:size-[44px] pointer-coarse:size-[44px]")}
      >
        <ChevronRight className="size-5" />
      </Link>
    </div>
  );
}
