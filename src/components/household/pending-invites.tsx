"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { revokeInviteAction } from "@/lib/actions/household";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export type PendingInvite = {
  id: string;
  // Null when the inviter's account is gone (invitedById is SetNull) or the
  // link predates the column.
  inviterName: string | null;
  // Formatted on the server so the text can't differ between the server
  // render and hydration when the viewer's time zone isn't the server's.
  expiresLabel: string;
  canRevoke: boolean;
};

// SEC-4. An invite is a bearer link that lets anyone who holds it join, so a
// member should be able to see which are still live and close the ones that
// are no longer wanted. The token itself is never shown here: a list that
// re-displays live join links would be one more place for them to leak.
export function PendingInvites({
  invites,
  dict,
}: {
  invites: PendingInvite[];
  dict: Dictionary["household"]["pendingInvites"];
}) {
  if (invites.length === 0) return null;

  // Runs from the ConfirmDialog, which owns the pending state (on the one
  // invite being closed, not every row) and toasts a returned error while
  // staying open so the user can retry.
  async function handleRevoke(id: string) {
    try {
      const result = await revokeInviteAction(id);
      if (result.error) return { error: result.error };
    } catch {
      return { error: dict.revokeFailed };
    }
    toast.success(dict.revoked);
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <div>
        <h2 className="font-heading text-base font-semibold">{dict.title}</h2>
        <p className="text-sm text-muted-foreground">{dict.description}</p>
      </div>
      <ul className="flex flex-col gap-2">
        {invites.map((invite) => {
          const name = invite.inviterName ?? dict.unknownInviter;
          return (
            <li key={invite.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="break-words text-sm">{format(dict.createdBy, { name })}</span>
                <span className="text-xs text-muted-foreground">
                  {format(dict.expires, { date: invite.expiresLabel })}
                </span>
              </div>
              {/* UX-206: closing can't be undone (only a new invite, sent
                  again, replaces it) and the link stops working for whoever
                  holds it right now, so it's confirmed first, like
                  shopping's "Revoke link" (DESIGN.md principle 5). The
                  description names the inviter and expiry so it's clear
                  which of several invites is closing. */}
              {invite.canRevoke && (
                <ConfirmDialog
                  alert
                  trigger={
                    <Button type="button" variant="outline" aria-label={format(dict.revokeAriaLabel, { name })}>
                      {dict.revoke}
                    </Button>
                  }
                  title={dict.revokeConfirmTitle}
                  description={format(dict.revokeConfirmDescription, { name, date: invite.expiresLabel })}
                  cancelLabel={dict.revokeConfirmCancel}
                  confirmLabel={dict.revoke}
                  pendingLabel={dict.revoking}
                  onConfirm={() => handleRevoke(invite.id)}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
