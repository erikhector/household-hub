"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type DialogHandle,
} from "@/components/ui/dialog";
import {
  moveShoppingListItemAction,
  undoMergedShoppingListMoveAction,
} from "@/app/dashboard/shopping-list/item-actions";
import { format } from "@/lib/i18n/format";
import type { ShoppingListDict } from "@/components/shopping/shopping-list-types";

export type MoveTarget = { id: string; name: string };

/**
 * GAP-82: the sheet behind a row's ⋯ "Move to list…": one button per other
 * active list, and a tap on one moves the row there at once. Picking is the
 * whole task, so there is no second confirm; the toast's Undo covers a slip
 * (DESIGN.md, user control). One instance per list page, opened through
 * `handle` for whichever row `item` names (the row's menu unmounts as it
 * closes, see createDialogHandle).
 */
export function MoveItemDialog({
  item,
  targets,
  dict,
  undoLabel,
  handle,
}: {
  item: { id: string; name: string } | null;
  targets: MoveTarget[];
  dict: ShoppingListDict["moveItem"];
  undoLabel: string;
  handle: DialogHandle;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [movingTo, setMovingTo] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function move(target: MoveTarget) {
    if (!item) return;
    setError(null);
    setMovingTo(target.id);
    startTransition(async () => {
      const result = await moveShoppingListItemAction(item.id, target.id);
      setMovingTo(null);
      // Said inside the sheet, which stays open: "already there in another
      // unit" is answered by picking another list or editing the row first.
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      const sourceListId = result.sourceListId ?? "";
      const merged = result.merged;
      toast.success(format(merged ? dict.mergedToast : dict.movedToast, { name: item.name, list: result.listName ?? target.name }), {
        action: {
          label: undoLabel,
          onClick: () => {
            // A plain move goes back the same way it came; a merge has to
            // split the quantity off the row it joined.
            const undo = merged
              ? undoMergedShoppingListMoveAction({ ...merged, sourceListId })
              : moveShoppingListItemAction(item.id, sourceListId);
            void undo.then((undone) => {
              if (undone.error) toast.error(undone.error);
            });
          },
        },
      });
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // The dialog stays mounted while closed, so the last row's error
        // must not greet the next one.
        if (next) setError(null);
        setOpen(next);
      }}
      handle={handle}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="break-words">{format(dict.title, { name: item?.name ?? "" })}</DialogTitle>
          <DialogDescription>{dict.description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {targets.map((target) => (
            <Button
              key={target.id}
              type="button"
              variant="outline"
              className="h-auto min-h-11 justify-start whitespace-normal py-2 text-left break-words"
              disabled={isPending}
              aria-busy={movingTo === target.id || undefined}
              onClick={() => move(target)}
            >
              {movingTo === target.id && <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />}
              {target.name}
            </Button>
          ))}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {dict.cancel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
