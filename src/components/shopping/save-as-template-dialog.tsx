"use client";

import { useActionState, useState } from "react";
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
  type DialogHandle,
} from "@/components/ui/dialog";
import { saveAsTemplateAction } from "@/app/dashboard/shopping-list/actions";
import { format } from "@/lib/i18n/format";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

const initialState: ActionState = {};

/**
 * GAP-4's "Save as template", opened from the list's ⋯ menu (same
 * handle-based pattern as ReorderSectionsDialog/ImportListDialog, since the
 * menu's popup unmounts as it closes). Only offered for an ACTIVE list with
 * at least one pending item (see shopping-list-client.tsx), so the
 * empty-list error saveAsTemplateAction can still return is a
 * defense-in-depth backstop, not something this dialog expects to show.
 */
export function SaveAsTemplateDialog({
  listId,
  dict,
  handle,
}: {
  listId: string;
  dict: Dictionary["shoppingList"]["saveAsTemplate"];
  handle: DialogHandle;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const result = await saveAsTemplateAction(prevState, formData);
    if (!result.error) {
      setOpen(false);
      toast.success(format(dict.savedToast, { name: String(formData.get("name")) }));
    }
    return result;
  }, initialState);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) setName("");
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} handle={handle}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dict.dialogTitle}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="listId" value={listId} />
          <p className="text-sm text-muted-foreground">{dict.description}</p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="save-as-template-name">{dict.nameLabel}</Label>
            <Input
              id="save-as-template-name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={dict.namePlaceholder}
              maxLength={120}
              autoFocus
            />
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? dict.saving : dict.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
