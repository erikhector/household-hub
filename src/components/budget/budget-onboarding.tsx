// First-run empty state for both budget pages: replaces Safe to Spend and the
// Due this period widget (both meaningless with zero categories) with a
// single, unmissable "add a category" prompt, rendered above the tab bar by
// BudgetTabs. Reuses AddCategoryDialog as-is (src/components/budget/category-manager.tsx)
// rather than duplicating the form, plus a one-click starter set
// (StarterCategoryPicker) below it — Budget's equivalent of Inventory's
// starter-kit chips (src/components/inventory/starter-kit-picker.tsx),
// following the same "manual option above, starter shortcut below a
// divider" layout as Inventory's empty state
// (src/components/inventory/inventory-table.tsx).
//
// BUDGET-5 merged the household and personal versions of this card. They
// differ only in copy (each page passes its own dictionary slice and an
// already-formatted `body`), the actions they call, and the household's
// currency row, which is the optional `currency` prop: the personal budget
// has no currency of its own, so it passes none.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AddCategoryDialog,
  type CategoryFormAction,
  type CategoryManagerDict,
} from "@/components/budget/category-manager";
import {
  StarterCategoryPicker,
  type StarterCategoriesAction,
  type StarterCategoryPickerDict,
} from "@/components/budget/starter-category-picker";
import { OnboardingCurrency } from "@/components/budget/onboarding-currency";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

export function BudgetOnboarding({
  dict,
  body,
  currency,
  createCategoryAction,
  createStarterCategoriesAction,
}: {
  dict: CategoryManagerDict & StarterCategoryPickerDict & { onboarding: { title: string } };
  // UX-110: each budget says whose money it holds, so the page formats the
  // body (the household one names the household) and passes the finished text.
  body: string;
  // UX-73: the household's currency (derived at signup) with one tap to
  // change it, so amounts aren't bare numbers from the first screen.
  currency?: {
    currencyCode: string | null;
    canChange: boolean;
    locale: Locale;
    dict: Dictionary["budget"]["onboarding"];
    currencyDict: Dictionary["household"]["currency"];
  };
  // BUDGET-3 made AddCategoryDialog take its create action as a prop instead
  // of importing it directly — threaded straight through from page.tsx,
  // since this component doesn't otherwise touch Server Actions itself.
  createCategoryAction: CategoryFormAction;
  createStarterCategoriesAction: StarterCategoriesAction;
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
          <p className="max-w-md text-sm text-muted-foreground">{body}</p>
          <AddCategoryDialog dict={dict} createAction={createCategoryAction} />
        </div>
        {currency && (
          <OnboardingCurrency
            currencyCode={currency.currencyCode}
            canChange={currency.canChange}
            locale={currency.locale}
            dict={currency.dict}
            currencyDict={currency.currencyDict}
          />
        )}
        <div className="border-t border-primary/20 pt-6">
          <StarterCategoryPicker dict={dict} createAction={createStarterCategoriesAction} />
        </div>
      </CardContent>
    </Card>
  );
}
