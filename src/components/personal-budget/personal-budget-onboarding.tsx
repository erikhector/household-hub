// Mirrors BudgetOnboarding (src/components/budget/budget-onboarding.tsx) for
// the personal budget page.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AddCategoryDialog } from "@/components/personal-budget/personal-category-manager";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export function PersonalBudgetOnboarding({ dict }: { dict: Dictionary["personalBudget"] }) {
  return (
    <Card className="border-2 border-primary/40 bg-primary/5">
      <CardHeader>
        <CardTitle className="font-heading text-base font-semibold text-foreground">
          {dict.onboarding.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-md text-sm text-muted-foreground">{dict.onboarding.body}</p>
        <AddCategoryDialog dict={dict} />
      </CardContent>
    </Card>
  );
}
