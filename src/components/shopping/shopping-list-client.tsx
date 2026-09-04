"use client";

import { useActionState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  addAdHocItemAction,
  completeShoppingListAction,
  deleteShoppingListItemAction,
  generateFromLowStockAction,
  togglePurchasedAction,
} from "@/app/dashboard/shopping-list/actions";
import type { ActionState } from "@/lib/actions/auth";

type ShoppingListItemRow = {
  id: string;
  name: string;
  quantity: number;
  purchased: boolean;
  addedAutomatically: boolean;
};

type ShoppingListData = {
  id: string;
  name: string;
  items: ShoppingListItemRow[];
};

const initialState: ActionState = {};

function AddItemForm() {
  const [state, formAction, pending] = useActionState(addAdHocItemAction, initialState);
  return (
    <form action={formAction} className="flex items-end gap-2">
      <div className="flex flex-col gap-1">
        <Input name="name" placeholder="Item name" required className="w-48" />
      </div>
      <Input
        name="quantity"
        type="number"
        min={0.01}
        step="any"
        defaultValue={1}
        className="w-20"
      />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Adding…" : "Add"}
      </Button>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}

export function ShoppingListClient({ list }: { list: ShoppingListData | null }) {
  const [isPending, startTransition] = useTransition();

  const pendingItems = list?.items.filter((item) => !item.purchased) ?? [];
  const purchasedItems = list?.items.filter((item) => item.purchased) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Shopping list</h1>
          <p className="text-sm text-muted-foreground">
            {list ? list.name : "No active list yet"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={isPending}
            onClick={() => startTransition(() => generateFromLowStockAction())}
          >
            Add low-stock items
          </Button>
          {list && list.items.length > 0 && (
            <Button
              variant="secondary"
              disabled={isPending}
              onClick={() => startTransition(() => completeShoppingListAction(list.id))}
            >
              Complete list
            </Button>
          )}
        </div>
      </div>

      <AddItemForm />

      <div className="flex flex-col gap-2">
        {pendingItems.length === 0 && purchasedItems.length === 0 ? (
          <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            Nothing on the list. Add items manually, or pull in what&apos;s low on
            stock.
          </p>
        ) : (
          <>
            {pendingItems.map((item) => (
              <ShoppingRow key={item.id} item={item} isPending={isPending} startTransition={startTransition} />
            ))}
            {purchasedItems.length > 0 && (
              <p className="mt-4 text-xs font-medium uppercase text-muted-foreground">
                Purchased
              </p>
            )}
            {purchasedItems.map((item) => (
              <ShoppingRow key={item.id} item={item} isPending={isPending} startTransition={startTransition} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function ShoppingRow({
  item,
  isPending,
  startTransition,
}: {
  item: ShoppingListItemRow;
  isPending: boolean;
  startTransition: (fn: () => void) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2">
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={item.purchased}
          disabled={isPending}
          onChange={() => startTransition(() => togglePurchasedAction(item.id))}
          className="size-4"
        />
        <span className={item.purchased ? "text-muted-foreground line-through" : ""}>
          {item.name} × {item.quantity}
        </span>
        {item.addedAutomatically && <Badge variant="secondary">Low stock</Badge>}
      </label>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground hover:text-destructive"
        disabled={isPending}
        onClick={() => startTransition(() => deleteShoppingListItemAction(item.id))}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}
