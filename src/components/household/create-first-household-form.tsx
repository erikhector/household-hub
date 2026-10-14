"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createHouseholdAction } from "@/lib/actions/household";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { PendingLabel } from "@/components/ui/pending-label";

const initialState: ActionState = {};

// The no-household page's inline counterpart to HouseholdSwitcher's
// CreateHouseholdDialog: same action, but there's no dashboard shell to hang
// a dialog off here. createHouseholdAction redirects to /dashboard on success.
export function CreateFirstHouseholdForm({ dict }: { dict: Dictionary["auth"]["noHousehold"] }) {
  const [state, formAction, pending] = useActionState(createHouseholdAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="first-household-name">{dict.householdName}</Label>
        <Input
          autoComplete="off"
          enterKeyHint="done"
          id="first-household-name"
          name="name"
          required
          maxLength={60}
          placeholder={dict.householdNamePlaceholder}
        />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        <PendingLabel pending={pending} busy={dict.creating} idle={dict.create} />
      </Button>
    </form>
  );
}
