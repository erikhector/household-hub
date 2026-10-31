// Server-rendered, presentational — no client state of its own. Each step's
// "done" flag is derived straight from data the dashboard overview page
// already has (or fetches for this purpose). Two choices are persisted
// (per-browser, per-household cookies): the household step's own copy offers
// "or skip it and use it solo", so it carries a skip button (see
// skipHouseholdStepAction in src/lib/actions/household.ts and A11 in
// docs/archive/UX_AUDIT_IMPLEMENTATION_PLAN.md), and the whole card can be
// hidden (dismissGettingStartedAction, UX-26).
//
// UX-69: finished steps used to vanish into a "3 of 5 done" line, which hid
// the progress made. Every step is now a row: done ones stay, ticked and
// quieter, under an "N of M" progress bar, and open ones come first so the
// next thing to do is still at the top (and, on a short phone, on the first
// screen). When the last step is done the card gives way to a one-off
// "You're all set" moment (GettingStartedAllSet), then disappears.

import Link from "next/link";
import type { ComponentType } from "react";
import { Package, ShoppingCart, Users, Wallet, CalendarDays, Check, ChevronRight, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PendingSubmitButton } from "@/components/dashboard/pending-submit-button";
import { GettingStartedAllSet } from "@/components/dashboard/getting-started-all-set";
import { dismissGettingStartedAction, skipHouseholdStepAction } from "@/lib/actions/household";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { cn } from "@/lib/utils";

export type GettingStartedStep = {
  key: "household" | "inventory" | "shoppingList" | "mealPlan" | "budget";
  href: string;
  done: boolean;
  /** Household step only: true once skipHouseholdStepAction has been used
   * for this household. Counted as finished (no longer nags) in the
   * "3 of 5 done" line. */
  skipped?: boolean;
};

const stepIcons: Record<GettingStartedStep["key"], ComponentType<{ className?: string }>> = {
  household: Users,
  inventory: Package,
  shoppingList: ShoppingCart,
  mealPlan: CalendarDays,
  budget: Wallet,
};

export function GettingStarted({
  steps,
  celebrated,
  dict,
}: {
  steps: GettingStartedStep[];
  /** True once this browser has seen the finish moment for this household. */
  celebrated: boolean;
  dict: Dictionary["dashboard"]["gettingStarted"];
}) {
  const isFinished = (s: GettingStartedStep) => s.done || !!s.skipped;
  const finished = steps.filter(isFinished).length;

  // Always mounted once everything is done, so the moment keeps its state
  // across the re-render that follows it recording the cookie.
  if (finished === steps.length) {
    return <GettingStartedAllSet show={!celebrated} dict={dict.allSet} />;
  }

  // Open steps first, finished ones after (both keep their own order).
  const ordered = [...steps.filter((s) => !isFinished(s)), ...steps.filter(isFinished)];
  const progressLabel = format(dict.progress, { done: finished, total: steps.length });

  return (
    <Card className="border-2 border-primary/40 bg-primary/5">
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-base font-semibold">{dict.title}</h2>
            <p className="text-sm text-muted-foreground">{dict.subtitle}</p>
          </div>
          <form action={dismissGettingStartedAction} className="shrink-0">
            <PendingSubmitButton
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label={dict.dismiss}
              title={dict.dismiss}
            >
              <X />
            </PendingSubmitButton>
          </form>
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">{progressLabel}</p>
          <div
            role="progressbar"
            aria-label={progressLabel}
            aria-valuemin={0}
            aria-valuemax={steps.length}
            aria-valuenow={finished}
            className="h-2 overflow-hidden rounded-full bg-primary/15"
          >
            <div
              className="h-full rounded-full bg-primary motion-safe:transition-[width]"
              style={{ width: `${(finished / steps.length) * 100}%` }}
            />
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {ordered.map((step) => {
            const Icon = stepIcons[step.key];
            const stepDict = dict.steps[step.key];
            const isDone = isFinished(step);
            // UX-152: the card is a size container and stacks (icon above
            // the text, chevron hidden) when it is narrower than 15rem. The
            // threshold is in rem, so it follows the text size: at default
            // size every phone is wider than it and the row layout stays;
            // at 200% text it is 480 px and the text gets the full card
            // width instead of the sliver left beside tile and chevron.
            const content = (
              <div
                className={cn(
                  "flex flex-col items-start gap-2 rounded-lg border bg-background p-3 transition-colors @[15rem]:flex-row @[15rem]:items-center @[15rem]:gap-3 hover:border-primary/50",
                  isDone && "bg-background/60",
                )}
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full",
                    isDone ? "bg-primary text-primary-foreground" : "bg-primary/15 text-primary",
                  )}
                >
                  {isDone ? <Check className="size-4" aria-hidden /> : <Icon className="size-4" />}
                </span>
                <div className="flex min-w-0 w-full flex-col gap-0.5 @[15rem]:w-auto @[15rem]:flex-1">
                  <p className={cn("text-sm font-medium", isDone && "text-muted-foreground")}>
                    {stepDict.title}
                    {isDone && <span className="sr-only"> ({dict.doneStep})</span>}
                  </p>
                  {!isDone && <p className="text-sm text-muted-foreground">{stepDict.description}</p>}
                </div>
                <ChevronRight className="hidden size-4 shrink-0 text-muted-foreground @[15rem]:block" aria-hidden />
              </div>
            );

            // The household step alone gets a "skip" affordance (its own
            // copy already says "or skip it") — a sibling <form>, not
            // nested inside the <Link> below, since a <form>/<button>
            // can't validly nest inside an <a>. Only while it's still open.
            if (step.key === "household" && !isDone) {
              return (
                <div key={step.key} className="flex flex-col gap-1.5">
                  <Link href={step.href} className="@container">
                    {content}
                  </Link>
                  <form action={skipHouseholdStepAction} className="self-end">
                    <PendingSubmitButton variant="ghost" size="xs" className="text-muted-foreground">
                      {dict.skip}
                    </PendingSubmitButton>
                  </form>
                </div>
              );
            }

            return (
              <Link key={step.key} href={step.href} className="@container">
                {content}
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
