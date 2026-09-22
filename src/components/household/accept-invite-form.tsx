"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { acceptInviteAction } from "@/lib/actions/household";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

const initialState: ActionState = {};

export function AcceptInviteForm({
  token,
  dict,
}: {
  token: string;
  dict: Dictionary["auth"]["join"];
}) {
  const [state, formAction, pending] = useActionState(acceptInviteAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <p className="text-sm text-muted-foreground">{dict.acceptConsequence}</p>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? dict.accepting : dict.accept}
      </Button>
    </form>
  );
}
