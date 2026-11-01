"use client";

// UX-HOME-2/3: Home's two "Add N" buttons, the only interactive bits of the
// Shopping & pantry and Today cards besides the task ticks. Neither has
// logic of its own: each calls the action its feature page already uses, so
// what lands on the list is exactly what the same tap there would add.
//
// - AddLowStockButton: the shopping list's "Add low-stock items"
//   (generateFromLowStockAction), which skips items already on the list and
//   stock ticked off but not put away yet.
// - AddMissingButton: the planner's "Add missing ingredients"
//   (addMissingIngredientsToShoppingListAction), with tonight's rows as the
//   reviewed selection. With no active list the action starts a new one,
//   the same as picking "New list" in the planner's dialog.
//
// Both show pending (Loader2, disabled) and then a toast with the count that
// actually landed (M5); the action's revalidation updates the card behind it.

import { useActionState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { generateFromLowStockAction } from "@/app/dashboard/shopping-list/list-actions";
import {
  addMissingIngredientsToShoppingListAction,
  type AddMissingState,
} from "@/app/dashboard/meal-planning/cooking-actions";
import { NEW_SHOPPING_LIST_SENTINEL } from "@/app/dashboard/meal-planning/meal-types";
import { settleOptimisticAction } from "@/components/shared/settle-optimistic-action";
import { format, plural, type PluralForms } from "@/lib/i18n/format";

export function AddLowStockButton({
  listId,
  label,
  ariaLabel,
  dict,
}: {
  listId: string;
  label: string;
  ariaLabel: string;
  dict: { addedToast: PluralForms; noneToast: string; saveFailedToast: string };
}) {
  const [pending, startTransition] = useTransition();
  const add = () =>
    startTransition(async () => {
      const result = await settleOptimisticAction(() => generateFromLowStockAction(listId), dict.saveFailedToast);
      if (!result) return;
      const added = result.added ?? 0;
      if (added > 0) toast.success(format(plural(added, dict.addedToast), { count: added }));
      else toast.info(dict.noneToast);
    });
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="ml-auto shrink-0"
      disabled={pending}
      aria-label={ariaLabel}
      onClick={add}
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
      {label}
    </Button>
  );
}

export type MissingRow = { name: string; quantity: number; unit: string; note: string | null };

export function AddMissingButton({
  rows,
  target,
  label,
  ariaLabel,
  dict,
}: {
  rows: MissingRow[];
  /** The list to add to, or null to start a new one (named like the planner's). */
  target: { id: string; name: string } | null;
  label: string;
  ariaLabel: string;
  dict: {
    addedToast: PluralForms;
    alreadyOnListToast: string;
    newListName: string;
    openList: string;
  };
}) {
  const router = useRouter();
  const [, formAction, pending] = useActionState(async (prev: AddMissingState, formData: FormData) => {
    const result = await addMissingIngredientsToShoppingListAction(prev, formData);
    if (result.error) {
      toast.error(result.error);
      return result;
    }
    const list = target?.name ?? dict.newListName;
    const added = result.addedCount ?? 0;
    const listId = result.listId;
    toast.success(
      added === 0
        ? format(dict.alreadyOnListToast, { list })
        : format(plural(added, dict.addedToast), { count: added, list }),
      listId
        ? { action: { label: dict.openList, onClick: () => router.push(`/dashboard/shopping-list/${listId}`) } }
        : undefined,
    );
    return result;
  }, {});

  return (
    <form action={formAction} className="ml-auto shrink-0">
      <input type="hidden" name="targetListId" value={target?.id ?? NEW_SHOPPING_LIST_SENTINEL} />
      {rows.map((row, i) => (
        <span key={i} hidden>
          <input type="hidden" name="itemName" value={row.name} />
          <input type="hidden" name="itemQuantity" value={row.quantity} />
          <input type="hidden" name="itemUnit" value={row.unit} />
          <input type="hidden" name="itemNote" value={row.note ?? ""} />
        </span>
      ))}
      <Button type="submit" variant="outline" size="sm" className="shrink-0" disabled={pending} aria-label={ariaLabel}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        {label}
      </Button>
    </form>
  );
}
