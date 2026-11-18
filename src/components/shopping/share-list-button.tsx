"use client";

import { useState, useTransition } from "react";
import { Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CopyLinkButton } from "@/components/ui/copy-link-button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  type DialogHandle,
} from "@/components/ui/dialog";
import { createShareLinkAction, revokeShareLinkAction } from "@/app/dashboard/shopping-list/share-actions";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

/**
 * Mirrors InviteButton's (src/components/household/invite-button.tsx)
 * show-link/copy-button UX for the household-invite feature, applied to a
 * ShoppingListShareLink instead — see REQUIREMENTS.md's shopping-list
 * "Share link" subsection for the permissions model (no login, view + check
 * off, manual revoke only). Only rendered for an ACTIVE list by the caller
 * (ShoppingListClient) — sharing a COMPLETED/ARCHIVED list to let visitors
 * check off items has no real use once the list is done.
 */
export function ShareListButton({
  shoppingListId,
  dict,
  handle,
}: {
  shoppingListId: string;
  dict: Dictionary["shoppingList"]["shareLink"];
  /** When set, the dialog opens through the handle (e.g. from a menu item)
   * and renders no button of its own. */
  handle?: DialogHandle;
}) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [shareLinkId, setShareLinkId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && !link) {
      // UX-201: a failed create's error would otherwise stay on screen
      // beside the working link this open fetches.
      setError(null);
      startTransition(async () => {
        const result = await createShareLinkAction(shoppingListId);
        if (result.url && result.shareLinkId) {
          setLink(result.url);
          setShareLinkId(result.shareLinkId);
        } else {
          setError(result.error ?? dict.createError);
        }
      });
    }
  }

  // Runs from the ConfirmDialog, which owns the pending state and toasts a
  // returned error (staying open so the user can retry).
  async function handleRevoke() {
    if (!shareLinkId) return;
    const result = await revokeShareLinkAction(shareLinkId);
    if (result.error) return { error: result.error || dict.revokeError };
    toast.success(dict.revokedToast);
    setLink(null);
    setShareLinkId(null);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} handle={handle}>
      {!handle && (
        <DialogTrigger render={<Button variant="outline"><Share2 className="size-4" />{dict.button}</Button>} />
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dict.dialogTitle}</DialogTitle>
        </DialogHeader>
        {isPending && !link && <p className="text-sm text-muted-foreground">{dict.generating}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {link && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">{dict.description}</p>
              <div className="flex flex-wrap gap-2">
                <Input
                  readOnly
                  className="min-w-[12rem] flex-1"
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label={dict.linkAriaLabel}
                />
                <CopyLinkButton url={link} dict={dict} shareTitle={dict.dialogTitle} />
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 border-t pt-4">
              <p className="text-sm text-muted-foreground">{dict.activeLabel}</p>
              {/* UX-201: revoking can't be undone (sharing again mints a new
                  token) and cuts off anyone shopping from the link right
                  now, so it's confirmed first (DESIGN.md principle 5). */}
              <ConfirmDialog
                alert
                trigger={<Button type="button" variant="destructive">{dict.revoke}</Button>}
                title={dict.revokeConfirmTitle}
                description={dict.revokeConfirmDescription}
                cancelLabel={dict.revokeConfirmCancel}
                confirmLabel={dict.revoke}
                pendingLabel={dict.revoking}
                onConfirm={handleRevoke}
              />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
