"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { deleteHouseholdAction } from "@/lib/actions/household";

export function DeleteHouseholdDialog({ householdName }: { householdName: string }) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isPending, startTransition] = useTransition();

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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirmText("");
      }}
    >
      <DialogTrigger render={<Button variant="destructive">Delete household</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {householdName}?</DialogTitle>
          <DialogDescription>
            This permanently deletes the household and everything in it &mdash;
            inventory, shopping lists, meal plans, and budget data &mdash; for every
            member. This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="confirm-household-name">
            Type <span className="font-semibold">{householdName}</span> to confirm
          </Label>
          <Input
            id="confirm-household-name"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoComplete="off"
          />
        </div>
        <DialogFooter>
          <Button
            variant="destructive"
            disabled={isPending || confirmText !== householdName}
            onClick={handleDelete}
          >
            <Trash2 className="size-4" />
            {isPending ? "Deleting…" : "Delete household"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
