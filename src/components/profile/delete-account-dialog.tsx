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
import { deleteAccountAction } from "@/app/dashboard/profile/actions";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

// Mirrors DeleteHouseholdDialog's confirm-before-destroy shape
// (src/components/household/delete-household-dialog.tsx), but the
// confirmation is the current password rather than typing the name back —
// deleteAccountAction requires it as a re-authentication gate (same
// reasoning as EmailForm/PasswordForm), so this dialog collects it directly
// rather than duplicating that check client-side.
export function DeleteAccountDialog({ dict }: { dict: Dictionary["profile"]["deleteAccount"] }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("currentPassword", password);
      const result = await deleteAccountAction({}, formData);
      if (result.error) {
        setError(result.error);
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setPassword("");
          setError(null);
        }
      }}
    >
      <DialogTrigger render={<Button variant="destructive">{dict.trigger}</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dict.title}</DialogTitle>
          <DialogDescription>{dict.description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="confirm-delete-account-password">{dict.confirmLabel}</Label>
          <Input
            id="confirm-delete-account-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            variant="destructive"
            disabled={isPending || password.length === 0}
            onClick={handleDelete}
          >
            <Trash2 className="size-4" />
            {isPending ? dict.deleting : dict.confirmButton}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
