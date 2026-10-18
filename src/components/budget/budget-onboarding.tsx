// First-run empty state for the Budget page: replaces Safe to Spend and the
// Due this period widget (both meaningless with zero categories) with a
// single, unmissable "add a category" prompt, rendered above the tab bar by
// BudgetTabs. Reuses AddCategoryDialog as-is (src/components/budget/category-manager.tsx)
// rather than duplicating the form, plus a one-click starter set
// (StarterCategoryPicker) below it — Budget's equivalent of Inventory's
// starter-kit chips (src/components/inventory/starter-kit-picker.tsx),
// following the same "manual option above, starter shortcut below a
// divider" layout as Inventory's empty state
// (src/components/inventory/inventory-table.tsx).

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AddCategoryDialog, type CategoryFormAction } from "@/components/budget/category-manager";
import { StarterCategoryPicker } from "@/components/budget/starter-category-picker";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export function BudgetOnboarding({
  dict,
  householdName,
  createCategoryAction,
}: {
  dict: Dictionary["budget"];
  // UX-110: the body says whose shared money this is, by name.
  householdName: string;
  // BUDGET-3 made AddCategoryDialog take its create action as a prop instead
  // of importing it directly — threaded straight through from page.tsx,
  // since this component doesn't otherwise touch Server Actions itself.
  createCategoryAction: CategoryFormAction;
}) {
  return (
    <Card className="border-2 border-primary/40 bg-primary/5">
      <CardHeader>
        <CardTitle className="font-heading text-base font-semibold text-foreground">
          {dict.onboarding.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-md text-sm text-muted-foreground">{format(dict.onboarding.body, { household: householdName })}</p>
          <AddCategoryDialog dict={dict} createAction={createCategoryAction} />
        </div>
        <div className="border-t border-primary/20 pt-6">
          <StarterCategoryPicker dict={dict} />
        </div>
      </CardContent>
    </Card>
  );
}
