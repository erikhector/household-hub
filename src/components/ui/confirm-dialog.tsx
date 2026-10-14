"use client";

// Shared "are you sure?" wrapper for destructive/removal actions — renders
// as the same bottom-sheet-on-mobile/centered-on-desktop Dialog used
// everywhere else in the app (see components/ui/dialog.tsx), so a delete
// confirmation looks and behaves like every other popup here. Fully
// self-contained (owns its own open state and pending transition) so a
// call site only needs to swap its existing instant-delete button for
// `trigger` and move the actual delete call into `onConfirm`.

import { useState, useTransition, type ReactElement } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  type DialogHandle,
} from "@/components/ui/dialog";
import { PendingLabel } from "@/components/ui/pending-label";

export function ConfirmDialog({
  trigger,
  title,
  description,
  cancelLabel,
  confirmLabel,
  pendingLabel,
  variant = "destructive",
  onConfirm,
  handle,
}: {
  /** The element that opens the dialog — usually the existing trash/remove
   * icon button, unchanged except its onClick moves into `onConfirm`.
   * Omit it when the dialog is opened through `handle` instead (e.g. from a
   * DropdownMenu item — see createDialogHandle). */
  trigger?: ReactElement;
  handle?: DialogHandle;
  title: string;
  description: string;
  cancelLabel: string;
  confirmLabel: string;
  pendingLabel: string;
  variant?: "destructive" | "default";
  /** May return an `{ error?: string }`-shaped result (this app's usual
   * server action return type) — a truthy `error` is toasted and the
   * dialog stays open so the user can retry; anything else closes it. */
  onConfirm: () => Promise<{ error?: string } | void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await onConfirm();
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      // A state update after an `await` isn't part of the transition any
      // more unless it's wrapped again. On its own it was an urgent update
      // landing right as the deleted row's exit animation (UX-33) started,
      // and React skips a view transition when that happens.
      startTransition(() => setOpen(false));
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen} handle={handle}>
      {trigger && <DialogTrigger render={trigger} />}
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="break-words">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={isPending} onClick={() => setOpen(false)}>
            {cancelLabel}
          </Button>
          <Button variant={variant} disabled={isPending} onClick={handleConfirm}>
            <PendingLabel pending={isPending} busy={pendingLabel} idle={confirmLabel} />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
