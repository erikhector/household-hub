// Server-rendered, presentational — no client state of its own. Each step's
// "done" flag is derived straight from data the dashboard overview page
// already has (or fetches for this purpose), so the checklist naturally
// disappears once a household has actually used the app. Two choices are
// persisted (per-browser, per-household cookies): the household step's own
// copy offers "or skip it and use it solo", so it carries a skip button (see
// skipHouseholdStepAction in src/lib/actions/household.ts and A11 in
// docs/archive/UX_AUDIT_IMPLEMENTATION_PLAN.md), and the whole card can be
// hidden (dismissGettingStartedAction, UX-26).
//
// UX-26: on a short phone screen (an iPhone SE, or any phone in landscape)
// the card used to list all five steps, finished ones included, and push
// everything about today below the fold. Finished steps now collapse into a
// single "3 of 5 done" line and only the open ones are listed.

import Link from "next/link";
import type { ComponentType } from "react";
import { Package, ShoppingCart, Users, Wallet, PiggyBank, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PendingSubmitButton } from "@/components/dashboard/pending-submit-button";
import { dismissGettingStartedAction, skipHouseholdStepAction } from "@/lib/actions/household";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export type GettingStartedStep = {
  key: "household" | "inventory" | "shoppingList" | "budget" | "personalBudget";
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
  budget: Wallet,
  personalBudget: PiggyBank,
};

export function GettingStarted({
  steps,
  dict,
}: {
  steps: GettingStartedStep[];
  dict: Dictionary["dashboard"]["gettingStarted"];
}) {
  const open = steps.filter((s) => !s.done && !s.skipped);
  if (open.length === 0) return null;
  const finished = steps.length - open.length;

  return (
    <Card className="border-2 border-primary/40 bg-primary/5">
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-base font-semibold">{dict.title}</h2>
            <p className="text-sm text-muted-foreground">
              {finished > 0
                ? format(dict.progress, { done: finished, total: steps.length })
                : dict.subtitle}
            </p>
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
        <div className="grid gap-2 sm:grid-cols-2">
          {open.map((step) => {
            const Icon = stepIcons[step.key];
            const stepDict = dict.steps[step.key];
            const content = (
              <div className="flex items-start gap-3 rounded-lg border bg-background p-3 transition-colors hover:border-primary/50">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <Icon className="size-4" />
                </span>
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm font-medium">{stepDict.title}</p>
                  <p className="text-xs text-muted-foreground">{stepDict.description}</p>
                </div>
              </div>
            );

            // The household step alone gets a "skip" affordance (its own
            // copy already says "or skip it") — a sibling <form>, not
            // nested inside the <Link> below, since a <form>/<button>
            // can't validly nest inside an <a>.
            if (step.key === "household") {
              return (
                <div key={step.key} className="flex flex-col gap-1.5">
                  <Link href={step.href}>{content}</Link>
                  <form action={skipHouseholdStepAction} className="self-end">
                    <PendingSubmitButton variant="ghost" size="xs" className="text-muted-foreground">
                      {dict.skip}
                    </PendingSubmitButton>
                  </form>
                </div>
              );
            }

            return (
              <Link key={step.key} href={step.href}>
                {content}
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
