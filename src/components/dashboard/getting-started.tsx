// Server-rendered, presentational — no client state of its own. Each step's
// "done" flag is derived straight from data the dashboard overview page
// already has (or fetches for this purpose), so the checklist naturally
// disappears once a household has actually used the app instead of relying
// on a dismiss button or a persisted flag.

import Link from "next/link";
import type { ComponentType } from "react";
import { Check, Package, ShoppingCart, Users, Wallet, PiggyBank } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export type GettingStartedStep = {
  key: "household" | "inventory" | "shoppingList" | "budget" | "personalBudget";
  href: string;
  done: boolean;
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
  const remaining = steps.filter((s) => !s.done).length;
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
            const content = (
              <div
                className={cn(
                  "flex items-start gap-3 rounded-lg border bg-background p-3 transition-colors",
                  step.done ? "opacity-60" : "hover:border-primary/50",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                    step.done ? "bg-chart-5/15 text-chart-5" : "bg-primary/15 text-primary",
                  )}
                >
                  {step.done ? <Check className="size-4" /> : <Icon className="size-4" />}
                </span>
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm font-medium">{stepDict.title}</p>
                  <p className="text-xs text-muted-foreground">{stepDict.description}</p>
                </div>
              </div>
            );
            return step.done ? (
              <div key={step.key}>{content}</div>
            ) : (
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
