"use client";

import Link from "next/link";
import { useActionState, useTransition } from "react";
import { ArrowLeft, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  addAdHocItemAction,
  archiveShoppingListAction,
  completeShoppingListAction,
  deleteShoppingListAction,
  deleteShoppingListItemAction,
  generateFromLowStockAction,
  togglePurchasedAction,
  unarchiveShoppingListAction,
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
  status: "ACTIVE" | "COMPLETED" | "ARCHIVED";
  items: ShoppingListItemRow[];
};

const initialState: ActionState = {};

function AddItemForm({ listId }: { listId: string }) {
  const [state, formAction, pending] = useActionState(addAdHocItemAction, initialState);
  return (
    <form action={formAction} className="flex items-end gap-2">
      <input type="hidden" name="listId" value={listId} />
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

const statusLabel: Record<ShoppingListData["status"], string> = {
  ACTIVE: "Active",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

export function ShoppingListClient({ list }: { list: ShoppingListData }) {
  const [isPending, startTransition] = useTransition();

  const pendingItems = list.items.filter((item) => !item.purchased);
  const purchasedItems = list.items.filter((item) => item.purchased);
  const isActive = list.status === "ACTIVE";

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/dashboard/shopping-list"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All shopping lists
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{list.name}</h1>
            {!isActive && <Badge variant="secondary">{statusLabel[list.status]}</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {isActive && (
            <Button
              variant="outline"
              disabled={isPending}
              onClick={() => startTransition(() => generateFromLowStockAction(list.id))}
            >
              Add low-stock items
            </Button>
          )}
          {isActive && list.items.length > 0 && (
            <Button
              variant="secondary"
              disabled={isPending}
              onClick={() => startTransition(() => completeShoppingListAction(list.id))}
            >
              Complete list
            </Button>
          )}
          {list.status === "ARCHIVED" ? (
            <Button
              variant="outline"
              disabled={isPending}
              onClick={() => startTransition(() => unarchiveShoppingListAction(list.id))}
            >
              <ArchiveRestore className="size-4" />
              Unarchive
            </Button>
          ) : (
            <Button
              variant="outline"
              disabled={isPending}
              onClick={() => startTransition(() => archiveShoppingListAction(list.id))}
            >
              <Archive className="size-4" />
              Archive
            </Button>
          )}
          <Button
            variant="destructive"
            disabled={isPending}
            onClick={() => startTransition(() => deleteShoppingListAction(list.id))}
          >
            <Trash2 className="size-4" />
            Delete
          </Button>
        </div>
      </div>

      {isActive && <AddItemForm listId={list.id} />}

      <div className="flex flex-col gap-2">
        {pendingItems.length === 0 && purchasedItems.length === 0 ? (
          <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            Nothing on this list{isActive ? " yet. Add items manually, or pull in what's low on stock." : "."}
          </p>
        ) : (
          <>
            {pendingItems.map((item) => (
              <ShoppingRow
                key={item.id}
                item={item}
                editable={isActive}
                isPending={isPending}
                startTransition={startTransition}
              />
            ))}
            {purchasedItems.length > 0 && (
              <p className="mt-4 text-xs font-medium uppercase text-muted-foreground">
                Purchased
              </p>
            )}
            {purchasedItems.map((item) => (
              <ShoppingRow
                key={item.id}
                item={item}
                editable={isActive}
                isPending={isPending}
                startTransition={startTransition}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function ShoppingRow({
  item,
  editable,
  isPending,
  startTransition,
}: {
  item: ShoppingListItemRow;
  editable: boolean;
  isPending: boolean;
  startTransition: (fn: () => void) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2">
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={item.purchased}
          disabled={isPending || !editable}
          onChange={() => startTransition(() => togglePurchasedAction(item.id))}
          className="size-4"
        />
        <span className={item.purchased ? "text-muted-foreground line-through" : ""}>
          {item.name} × {item.quantity}
        </span>
        {item.addedAutomatically && <Badge variant="secondary">Low stock</Badge>}
      </label>
      {editable && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-destructive"
          disabled={isPending}
          onClick={() => startTransition(() => deleteShoppingListItemAction(item.id))}
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
