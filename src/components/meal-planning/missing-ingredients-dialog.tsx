"use client";

import { useActionState, useState, useTransition } from "react";
import { ListPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addMissingIngredientsToShoppingListAction,
  previewMissingIngredientsAction,
} from "@/app/dashboard/meal-planning/actions";
import { NEW_SHOPPING_LIST_SENTINEL } from "@/app/dashboard/meal-planning/meal-types";
import { format, plural } from "@/lib/i18n/format";
import type { ActiveShoppingListOption, MissingIngredientData } from "@/components/meal-planning/types";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type MealPlanningDict = Dictionary["mealPlanning"];

type ReviewItem = MissingIngredientData & { included: boolean };

const initialState: ActionState = {};

export function MissingIngredientsDialog({
  dict,
  weekStartKey,
  activeShoppingLists,
}: {
  dict: MealPlanningDict;
  weekStartKey: string;
  activeShoppingLists: ActiveShoppingListOption[];
}) {
  const [open, setOpen] = useState(false);
  const [isPreviewPending, startPreviewTransition] = useTransition();
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [targetListId, setTargetListId] = useState(
    activeShoppingLists[0]?.id ?? NEW_SHOPPING_LIST_SENTINEL,
  );

  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const result = await addMissingIngredientsToShoppingListAction(prevState, formData);
    if (!result.error) {
      const listName =
        targetListId === NEW_SHOPPING_LIST_SENTINEL
          ? String(formData.get("newListName") || "").trim() || dict.newShoppingListOption
          : (activeShoppingLists.find((l) => l.id === targetListId)?.name ?? "");
      toast.success(format(dict.missingIngredientsAddedToast, { list: listName }));
      setOpen(false);
    }
    return result;
  }, initialState);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;

    // Always recompute on open rather than caching across opens — the meal
    // plan or inventory may have changed since the dialog was last shown,
    // and this stays cheap (a handful of rows at household scale).
    setItems(null);
    setPreviewError(null);
    startPreviewTransition(async () => {
      const result = await previewMissingIngredientsAction(weekStartKey);
      if ("error" in result) {
        setPreviewError(result.error);
      } else {
        setItems(result.items.map((item) => ({ ...item, included: true })));
      }
    });
  }

  function toggleItem(key: string) {
    setItems((prev) =>
      prev ? prev.map((item) => (item.key === key ? { ...item, included: !item.included } : item)) : prev,
    );
  }

  const targetListLabel = (value: string) =>
    value === NEW_SHOPPING_LIST_SENTINEL
      ? dict.newShoppingListOption
      : (activeShoppingLists.find((l) => l.id === value)?.name ?? value);

  const includedCount = items?.filter((item) => item.included).length ?? 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm">
            <ListPlus className="size-4" />
            {dict.addMissingIngredients}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dict.missingIngredientsDialogTitle}</DialogTitle>
        </DialogHeader>

        {isPreviewPending || items === null ? (
          <p className="text-sm text-muted-foreground">
            {previewError ?? dict.loadingMissingIngredients}
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{dict.noMissingIngredients}</p>
        ) : (
          <form action={formAction} className="flex flex-col gap-4">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              {format(plural(items.length, dict.missingIngredientCount), { count: items.length })}
            </p>

            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {items.map((item) => (
                <label
                  key={item.key}
                  className="flex items-center gap-2 rounded-md bg-muted px-2 py-1.5 text-sm"
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={item.included}
                    onChange={() => toggleItem(item.key)}
                  />
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {item.missingQuantity} {item.unit}
                  </span>
                  {item.included && (
                    <>
                      <input type="hidden" name="itemName" value={item.name} />
                      <input type="hidden" name="itemQuantity" value={item.missingQuantity} />
                      <input type="hidden" name="itemUnit" value={item.unit} />
                    </>
                  )}
                </label>
              ))}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="targetListId">{dict.targetListLabel}</Label>
              <Select
                value={targetListId}
                onValueChange={(v) => setTargetListId(v ?? NEW_SHOPPING_LIST_SENTINEL)}
              >
                <SelectTrigger id="targetListId" className="w-full">
                  <SelectValue>{targetListLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {activeShoppingLists.map((list) => (
                    <SelectItem key={list.id} value={list.id}>
                      {list.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW_SHOPPING_LIST_SENTINEL}>
                    {dict.newShoppingListOption}
                  </SelectItem>
                </SelectContent>
              </Select>
              <input type="hidden" name="targetListId" value={targetListId} />
            </div>

            {targetListId === NEW_SHOPPING_LIST_SENTINEL && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="newListName">{dict.newListNameLabel}</Label>
                <Input id="newListName" name="newListName" placeholder={dict.newListNamePlaceholder} />
              </div>
            )}

            {state.error && <p className="text-sm text-destructive">{state.error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={pending || includedCount === 0}>
                {pending ? dict.adding : dict.addMissingIngredientsSubmit}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
