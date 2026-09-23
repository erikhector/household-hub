// Server-rendered, presentational — no client state of its own. Each step's
// "done" flag is derived straight from data the dashboard overview page
// already has (or fetches for this purpose), so the checklist naturally
// disappears once a household has actually used the app instead of relying
// on a dismiss button or a persisted flag. The one exception is the
// household step: its own copy offers "or skip it and use it solo", so it
// carries a real dismiss button wired to a persisted (cookie) flag — see
// skipHouseholdStepAction in src/lib/actions/household.ts and A11 in
// docs/archive/UX_AUDIT_IMPLEMENTATION_PLAN.md.

import Link from "next/link";
import type { ComponentType } from "react";
import { Check, Minus, Package, ShoppingCart, Users, Wallet, PiggyBank } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { skipHouseholdStepAction } from "@/lib/actions/household";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export type GettingStartedStep = {
  key: "household" | "inventory" | "shoppingList" | "budget" | "personalBudget";
  href: string;
  done: boolean;
  /** Household step only: true once skipHouseholdStepAction has been used
   * for this household — rendered like `done` (no longer nags) but with a
   * distinct icon/label so it doesn't read as "you invited someone". */
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
  const remaining = steps.filter((s) => !s.done && !s.skipped).length;
  if (remaining === 0) return null;

  return (
    <Card className="border-2 border-primary/40 bg-primary/5">
      <CardContent className="flex flex-col gap-4">
        <div>
          <h2 className="font-heading text-base font-semibold">{dict.title}</h2>
          <p className="text-sm text-muted-foreground">{dict.subtitle}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {steps.map((step) => {
            const Icon = stepIcons[step.key];
            const stepDict = dict.steps[step.key];
            const isDone = step.done || step.skipped;
            const content = (
              <div
                className={cn(
                  "flex items-start gap-3 rounded-lg border bg-background p-3 transition-colors",
                  isDone ? "opacity-60" : "hover:border-primary/50",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                    isDone ? "bg-chart-5/15 text-chart-5" : "bg-primary/15 text-primary",
                  )}
                >
                  {step.done ? (
                    <Check className="size-4" />
                  ) : step.skipped ? (
                    <Minus className="size-4" />
                  ) : (
                    <Icon className="size-4" />
                  )}
                </span>
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm font-medium">{stepDict.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {step.skipped ? dict.skipped : stepDict.description}
                  </p>
                </div>
              </div>
            );

            if (isDone) {
              return <div key={step.key}>{content}</div>;
            }

            // The household step alone gets a "skip" affordance (its own
            // copy already says "or skip it") — a sibling <form>, not
            // nested inside the <Link> below, since a <form>/<button>
            // can't validly nest inside an <a>.
            if (step.key === "household") {
              return (
                <div key={step.key} className="flex flex-col gap-1.5">
                  <Link href={step.href}>{content}</Link>
                  <form action={skipHouseholdStepAction} className="self-end">
                    <Button type="submit" variant="ghost" size="xs" className="text-muted-foreground">
                      {dict.skip}
                    </Button>
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
