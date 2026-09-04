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
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type ListSummary = {
  id: string;
  name: string;
  status: "ACTIVE" | "COMPLETED" | "ARCHIVED";
  pendingItemCount: number;
};

type ShoppingListDict = Dictionary["shoppingList"];

const initialState: ActionState = {};

function NewListDialog({ dict }: { dict: ShoppingListDict }) {
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
            {dict.newList}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dict.newListDialogTitle}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-list-name">{dict.nameLabel}</Label>
            <Input
              id="new-list-name"
              name="name"
              placeholder={`${dict.defaultNamePrefix} — ${new Date().toLocaleDateString()}`}
              autoFocus
            />
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? dict.creating : dict.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ListCard({ list, dict }: { list: ListSummary; dict: ShoppingListDict }) {
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
              {format(plural(list.pendingItemCount, dict.itemsToBuy), {
                count: list.pendingItemCount,
              })}
            </p>
          ) : (
            <Badge variant="secondary">
              {list.status === "COMPLETED" ? dict.statusCompleted : dict.statusArchived}
            </Badge>
          )}
        </div>
      </Link>
      <div className="flex shrink-0 items-center gap-1">
        {list.status !== "ARCHIVED" ? (
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={isPending}
            aria-label={dict.archiveAriaLabel}
            onClick={() => startTransition(() => archiveShoppingListAction(list.id))}
          >
            <Archive className="size-3.5" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={isPending}
            aria-label={dict.unarchiveAriaLabel}
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
          aria-label={dict.deleteAriaLabel}
          onClick={() => startTransition(() => deleteShoppingListAction(list.id))}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function ListSection({
  title,
  lists,
  dict,
}: {
  title: string;
  lists: ListSummary[];
  dict: ShoppingListDict;
}) {
  if (lists.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium uppercase text-muted-foreground">{title}</p>
      <div className="flex flex-col gap-2">
        {lists.map((list) => (
          <ListCard key={list.id} list={list} dict={dict} />
        ))}
      </div>
    </div>
  );
}

export function ShoppingListsOverview({
  active,
  completed,
  archived,
  dict,
}: {
  active: ListSummary[];
  completed: ListSummary[];
  archived: ListSummary[];
  dict: ShoppingListDict;
}) {
  const isEmpty = active.length === 0 && completed.length === 0 && archived.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{dict.title}</h1>
          <p className="text-sm text-muted-foreground">{dict.subtitle}</p>
        </div>
        <NewListDialog dict={dict} />
      </div>

      {isEmpty ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {dict.empty}
        </p>
      ) : (
        <>
          <ListSection title={dict.sectionActive} lists={active} dict={dict} />
          <ListSection title={dict.sectionCompleted} lists={completed} dict={dict} />
          <ListSection title={dict.sectionArchived} lists={archived} dict={dict} />
        </>
      )}
    </div>
  );
}
