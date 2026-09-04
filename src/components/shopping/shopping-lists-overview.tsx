"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
  archiveShoppingListAction,
  createShoppingListAction,
  deleteShoppingListAction,
  unarchiveShoppingListAction,
} from "@/app/dashboard/shopping-list/actions";
import type { ActionState } from "@/lib/actions/auth";

type ListSummary = {
  id: string;
  name: string;
  status: "ACTIVE" | "COMPLETED" | "ARCHIVED";
  pendingItemCount: number;
};

const initialState: ActionState = {};

function NewListDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const result = await createShoppingListAction(prevState, formData);
    if (!result.error) setOpen(false);
    return result;
  }, initialState);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <Plus className="size-4" />
            New list
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New shopping list</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-list-name">Name</Label>
            <Input
              id="new-list-name"
              name="name"
              placeholder={`Shopping list — ${new Date().toLocaleDateString()}`}
              autoFocus
            />
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create list"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ListCard({ list }: { list: ListSummary }) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
      <Link
        href={`/dashboard/shopping-list/${list.id}`}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <ShoppingCart className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-medium">{list.name}</p>
          {list.status === "ACTIVE" ? (
            <p className="text-sm text-muted-foreground">
              {list.pendingItemCount} {list.pendingItemCount === 1 ? "item" : "items"} to buy
            </p>
          ) : (
            <Badge variant="secondary">{list.status === "COMPLETED" ? "Completed" : "Archived"}</Badge>
          )}
        </div>
      </Link>
      <div className="flex shrink-0 items-center gap-1">
        {list.status !== "ARCHIVED" ? (
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={isPending}
            aria-label="Archive list"
            onClick={() => startTransition(() => archiveShoppingListAction(list.id))}
          >
            <Archive className="size-3.5" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={isPending}
            aria-label="Unarchive list"
            onClick={() => startTransition(() => unarchiveShoppingListAction(list.id))}
          >
            <ArchiveRestore className="size-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive"
          disabled={isPending}
          aria-label="Delete list"
          onClick={() => startTransition(() => deleteShoppingListAction(list.id))}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function ListSection({ title, lists }: { title: string; lists: ListSummary[] }) {
  if (lists.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium uppercase text-muted-foreground">{title}</p>
      <div className="flex flex-col gap-2">
        {lists.map((list) => (
          <ListCard key={list.id} list={list} />
        ))}
      </div>
    </div>
  );
}

export function ShoppingListsOverview({
  active,
  completed,
  archived,
}: {
  active: ListSummary[];
  completed: ListSummary[];
  archived: ListSummary[];
}) {
  const isEmpty = active.length === 0 && completed.length === 0 && archived.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Shopping lists</h1>
          <p className="text-sm text-muted-foreground">
            Keep separate lists for the weekly shop, a big trip, or anything else.
          </p>
        </div>
        <NewListDialog />
      </div>

      {isEmpty ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          No shopping lists yet. Create one to get started.
        </p>
      ) : (
        <>
          <ListSection title="Active" lists={active} />
          <ListSection title="Completed" lists={completed} />
          <ListSection title="Archived" lists={archived} />
        </>
      )}
    </div>
  );
}
