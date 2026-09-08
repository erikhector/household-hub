// First-run empty state for the Budget page: replaces Safe to Spend and the
// Due this period widget (both meaningless with zero categories) with a
// single, unmissable "add a category" prompt, rendered above the tab bar by
// BudgetTabs. Reuses AddCategoryDialog as-is (src/components/budget/category-manager.tsx)
// rather than duplicating the form.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AddCategoryDialog } from "@/components/budget/category-manager";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export function BudgetOnboarding({ dict }: { dict: Dictionary["budget"] }) {
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
