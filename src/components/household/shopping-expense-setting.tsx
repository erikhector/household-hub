"use client";

import { useOptimistic, useTransition } from "react";
import { Wallet } from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setShoppingExpenseCategoryAction } from "@/lib/actions/household";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

// Base UI's Select can't hold null, so "nothing picked yet" rides on a
// sentinel that can never be a cuid.
const DEFAULT_VALUE = "__default__";

// Household.shoppingExpenseCategory's card on the Household page: which
// expense category a completed shopping list or registered receipt logs its
// total to. Saves on change with useOptimistic, like InventorySyncSetting,
// but open to every member (see setShoppingExpenseCategoryAction). The
// automatic "Groceries" option only shows while nothing is picked: the
// first priced trip pins that category, after which it's an ordinary entry
// in the list (under whatever it has been renamed to).
export function ShoppingExpenseSetting({
  categoryId,
  categories,
  dict,
}: {
  categoryId: string | null;
  categories: { id: string; name: string }[];
  dict: Dictionary["household"]["shoppingExpense"];
}) {
  const [isPending, startTransition] = useTransition();
  const [optimisticValue, setOptimisticValue] = useOptimistic(categoryId ?? DEFAULT_VALUE);
  const labels = new Map(categories.map((c) => [c.id, c.name]));
  labels.set(DEFAULT_VALUE, dict.defaultOption);

  function handleChange(next: string) {
    if (next === optimisticValue) return;
    startTransition(async () => {
      setOptimisticValue(next);
      const result = await setShoppingExpenseCategoryAction(next === DEFAULT_VALUE ? null : next);
      if (result.error) toast.error(result.error);
      else toast.success(dict.savedToast);
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 font-heading text-base font-semibold">
          <Wallet className="size-4 shrink-0" />
          {dict.title}
        </h2>
        <p className="text-sm text-muted-foreground">{dict.description}</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="household-shopping-expense">{dict.label}</Label>
        <Select value={optimisticValue} onValueChange={(v) => v && handleChange(v)} disabled={isPending}>
          <SelectTrigger id="household-shopping-expense" className="w-full sm:w-72">
            <SelectValue>{(v: string) => labels.get(v) ?? v}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {categoryId === null && <SelectItem value={DEFAULT_VALUE}>{dict.defaultOption}</SelectItem>}
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
