"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type DialogHandle,
} from "@/components/ui/dialog";
import { renameShoppingListAction } from "@/app/dashboard/shopping-list/list-actions";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { PendingLabel } from "@/components/ui/pending-label";
import { FieldError, fieldErrorId } from "@/components/auth/field-error";
import { useRequiredFields } from "@/components/shared/use-required-fields";

// UX-85: rename a list. Opened from the list's ⋯ menu or by tapping its
// title, both through `handle` (the menu unmounts as it closes, see
// createDialogHandle), the same way SaveTemplateDialog is.

const initialState: ActionState = {};

export function RenameListDialog({
  listId,
  listName,
  dict,
  handle,
}: {
  listId: string;
  listName: string;
  dict: Dictionary["shoppingList"]["renameList"];
  handle: DialogHandle;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (prevState: ActionState, formData: FormData) => {
      const result = await renameShoppingListAction(prevState, formData);
      if (!result.error) setOpen(false);
      return result;
    },
    initialState,
  );
  // UX-183b: a cleared name is worded under the field in the page's language
  // (`noValidate`), not by the browser's own bubble.
  const req = useRequiredFields();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // The dialog stays mounted while closed, so a message left by an
        // empty submit must not greet the next opening.
        req.clear();
        setOpen(next);
      }}
      handle={handle}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dict.dialogTitle}</DialogTitle>
        </DialogHeader>
        <form
          action={formAction}
          onSubmit={(event) => {
            req.check(event, [{ name: "name", id: "rename-list-name", message: dict.nameRequired }]);
          }}
          onInput={req.onInput}
          noValidate
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="listId" value={listId} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="rename-list-name">{dict.nameLabel}</Label>
            <Input
              autoComplete="off"
              enterKeyHint="done"
              id="rename-list-name"
              name="name"
              defaultValue={listName}
              maxLength={120}
              required
              autoFocus
              aria-invalid={req.messageFor("name") ? true : undefined}
              aria-describedby={req.messageFor("name") ? fieldErrorId("rename-list-name") : undefined}
            />
            <FieldError fieldId="rename-list-name">{req.messageFor("name")}</FieldError>
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
