"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  const [isPending, startTransition] = useTransition();

  if (invites.length === 0) return null;

  function handleRevoke(id: string) {
    startTransition(async () => {
      try {
        const result = await revokeInviteAction(id);
        if (result.error) toast.error(result.error);
        else toast.success(dict.revoked);
      } catch {
        toast.error(dict.revokeFailed);
      }
    });
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
              {invite.canRevoke && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={isPending}
                  aria-label={format(dict.revokeAriaLabel, { name })}
                  onClick={() => handleRevoke(invite.id)}
                >
                  {dict.revoke}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
