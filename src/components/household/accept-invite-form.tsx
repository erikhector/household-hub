"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { acceptInviteAction } from "@/lib/actions/household";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { PendingLabel } from "@/components/ui/pending-label";
import { guardFormAction } from "@/components/shared/guard-form-action";

const initialState: ActionState = {};

export function AcceptInviteForm({
  token,
  dict,
  requestFailed,
}: {
  token: string;
  dict: Dictionary["auth"]["join"];
  /** `errors.requestFailed`, for a request that never arrives (UX-210). */
  requestFailed: string;
}) {
  // UX-210: a dropped connection is an error line, not the crash page.
  const [state, formAction, pending] = useActionState(guardFormAction(acceptInviteAction, requestFailed), initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <p className="text-sm text-muted-foreground">{dict.acceptConsequence}</p>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        <PendingLabel pending={pending} busy={dict.accepting} idle={dict.accept} />
      </Button>
    </form>
  );
}
