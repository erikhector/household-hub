"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  type DialogHandle,
} from "@/components/ui/dialog";
import { renameShoppingListAction } from "@/app/dashboard/shopping-list/actions";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { PendingLabel } from "@/components/ui/pending-label";

// UX-85: renaming a list. Opened through `handle` from the list's ⋯ menu
// and from the pencil beside its title (the menu unmounts as it closes, see
// createDialogHandle), so both entry points share one dialog.

const initialState: ActionState = {};

export function RenameListDialog({
  listId,
  listName,
  dict,
  handle,
}: {
  listId: string;
  listName: string;
  dict: Dictionary["shoppingList"]["rename"];
  handle: DialogHandle;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(async (prevState: ActionState, formData: FormData) => {
    const result = await renameShoppingListAction(prevState, formData);
    if (!result.error) setOpen(false);
    return result;
  }, initialState);

  return (
    <Dialog open={open} onOpenChange={setOpen} handle={handle}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dict.dialogTitle}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="listId" value={listId} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="rename-list-name">{dict.nameLabel}</Label>
            {/* Keyed on the saved name so reopening starts from the current
                one, not from whatever was typed and abandoned last time. */}
            <Input
              key={listName}
              autoComplete="off"
              enterKeyHint="done"
              id="rename-list-name"
              name="name"
              defaultValue={listName}
              maxLength={120}
              required
              autoFocus
            />
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {dict.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              <PendingLabel pending={pending} busy={dict.saving} idle={dict.save} />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
