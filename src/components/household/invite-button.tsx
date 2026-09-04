"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createInviteAction } from "@/lib/actions/household";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export function InviteButton({ dict }: { dict: Dictionary["household"]["invite"] }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && !link) {
      startTransition(async () => {
        const result = await createInviteAction();
        if (result.url) {
          setLink(`${window.location.origin}${result.url}`);
        } else {
          setError(result.error ?? "Could not create invite link");
        }
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline">{dict.button}</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dict.dialogTitle}</DialogTitle>
        </DialogHeader>
        {isPending && !link && (
          <p className="text-sm text-muted-foreground">{dict.generating}</p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {link && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">{dict.description}</p>
            <div className="flex gap-2">
              <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigator.clipboard.writeText(link)}
              >
                {dict.copy}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
