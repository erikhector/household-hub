"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteHouseholdAction, getHouseholdDeleteEligibilityAction } from "@/lib/actions/household";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export function DeleteHouseholdDialog({
  householdName,
  dict,
}: {
  householdName: string;
  dict: Dictionary["household"]["delete"];
}) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isPending, startTransition] = useTransition();
  const [isChecking, startCheckTransition] = useTransition();
  const [blockedReason, setBlockedReason] = useState<string | null>(null);

  // Checked up front, before the type-to-confirm flow ever opens, so a sole
  // owner learns this is blocked immediately instead of after typing the
  // household's name to confirm — see A9 in docs/archive/UX_AUDIT_IMPLEMENTATION_PLAN.md.
  function handleTriggerClick() {
    startCheckTransition(async () => {
      const result = await getHouseholdDeleteEligibilityAction();
      if (result.blocked) {
        setBlockedReason(result.reason ?? null);
      } else {
        setOpen(true);
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteHouseholdAction();
      if (result.error) {
        toast.error(result.error);
        setOpen(false);
      }
    });
  }

  return (
    <>
      <Button variant="destructive" disabled={isChecking} onClick={handleTriggerClick}>
        {isChecking ? dict.checking : dict.trigger}
      </Button>

      <Dialog open={blockedReason !== null} onOpenChange={(next) => !next && setBlockedReason(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dict.blockedTitle}</DialogTitle>
            <DialogDescription>{blockedReason}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>{dict.blockedClose}</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setConfirmText("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="break-words">{format(dict.title, { name: householdName })}</DialogTitle>
            <DialogDescription>{dict.description}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirm-household-name" className="break-words">
              {format(dict.confirmLabel, { name: householdName })}
            </Label>
            <Input
              id="confirm-household-name"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>{dict.cancel}</DialogClose>
            <Button
              variant="destructive"
              disabled={isPending || confirmText.trim() !== householdName.trim()}
              onClick={handleDelete}
            >
              <Trash2 className="size-4" />
              {isPending ? dict.deleting : dict.confirmButton}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
