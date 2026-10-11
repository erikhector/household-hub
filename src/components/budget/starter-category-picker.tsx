"use client";

// Budget's equivalent of Inventory's StarterKitPicker
// (src/components/inventory/starter-kit-picker.tsx): a one-click way past a
// blank budget instead of typing categories one at a time through
// AddCategoryDialog. There's only one starter set here (not several kits to
// switch between, since categories are already grouped by type), so this
// skips the kit-switcher and just groups the toggleable chips by type using
// the same section labels as CategoryManager
// (dict.categories.incomeSection/expenseSection/savingsSection).
//
// Item names/types come straight out of the locale dictionary
// (`dict.starterCategories.items`) so every locale gets its own translated
// set; only the `id`s are shared across locales, used as stable
// React/selection keys.

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createStarterCategoriesAction } from "@/app/dashboard/budget/actions";
import { format, plural } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type StarterCategoryType = "INCOME" | "EXPENSE" | "SAVINGS";

export function StarterCategoryPicker({ dict }: { dict: Dictionary["budget"] }) {
  const items = dict.starterCategories.items;
  const [selected, setSelected] = useState<Set<string>>(new Set(items.map((item) => item.id)));
  const [isPending, startTransition] = useTransition();

  if (items.length === 0) return null;

  const toggleItem = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const typeLabel = (type: StarterCategoryType) => {
    if (type === "INCOME") return dict.categories.incomeSection;
    if (type === "SAVINGS") return dict.categories.savingsSection;
    return dict.categories.expenseSection;
  };

  const groups = (["INCOME", "EXPENSE", "SAVINGS"] as const)
    .map((type) => ({ type, items: items.filter((item) => item.type === type) }))
    .filter((group) => group.items.length > 0);

  const handleAdd = () => {
    const toAdd = items.filter((item) => selected.has(item.id));
    if (toAdd.length === 0) {
      toast.error(dict.starterCategories.noneSelected);
      return;
    }
    startTransition(async () => {
      const result = await createStarterCategoriesAction(
        toAdd.map((item) => ({ name: item.name, type: item.type as StarterCategoryType })),
      );
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const added = result.added ?? 0;
      if (added === 0) {
        toast.success(dict.starterCategories.allAlreadyAdded);
        return;
      }
      toast.success(format(plural(added, dict.starterCategories.addedToast), { count: added }));
    });
  };

  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      <div>
        <p className="text-sm font-medium">{dict.starterCategories.heading}</p>
        <p className="text-xs text-muted-foreground">{dict.starterCategories.description}</p>
      </div>
      <div className="flex flex-col gap-2">
        {groups.map((group) => (
          <div key={group.type} className="flex flex-col items-start gap-1.5">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              {typeLabel(group.type)}
            </p>
            <div className="flex flex-wrap gap-2">
              {group.items.map((item) => {
                const isSelected = selected.has(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => toggleItem(item.id)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors max-sm:min-h-11 pointer-coarse:min-h-11",
                      isSelected
                        ? "border-primary bg-primary/10 font-medium text-primary"
                        : "border-input text-muted-foreground hover:border-primary/50",
                    )}
                  >
                    {isSelected && <Check aria-hidden className="size-3" />}
                    {item.name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <Button type="button" size="sm" onClick={handleAdd} disabled={isPending}>
        {isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          format(plural(selected.size, dict.starterCategories.addSelected), { count: selected.size })
        )}
      </Button>
    </div>
  );
}
