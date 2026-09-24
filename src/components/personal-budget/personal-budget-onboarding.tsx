// Mirrors BudgetOnboarding (src/components/budget/budget-onboarding.tsx) for
// the personal budget page.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AddCategoryDialog, type CategoryFormAction } from "@/components/budget/category-manager";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export function PersonalBudgetOnboarding({
  dict,
  createCategoryAction,
}: {
  dict: Dictionary["personalBudget"];
  // BUDGET-3 merged CategoryManager/AddCategoryDialog into
  // src/components/budget/category-manager.tsx, which now takes its create
  // action as a prop instead of importing one directly — threaded straight
  // through from page.tsx.
  createCategoryAction: CategoryFormAction;
}) {
  return (
    <Card className="border-2 border-primary/40 bg-primary/5">
      <CardHeader>
        <CardTitle className="font-heading text-base font-semibold text-foreground">
          {dict.onboarding.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-md text-sm text-muted-foreground">{dict.onboarding.body}</p>
        <AddCategoryDialog dict={dict} createAction={createCategoryAction} />
      </CardContent>
    </Card>
  );
}
