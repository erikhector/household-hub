"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError, fieldErrorId } from "@/components/auth/field-error";
import { useRequiredFields } from "@/components/shared/use-required-fields";
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
  // UX-183b: an empty name is worded under the field in the page's language
  // (`noValidate`), not by the browser's own bubble.
  const req = useRequiredFields();

  return (
    <form
      action={formAction}
      onSubmit={(event) =>
        req.check(event, [{ name: "name", id: "first-household-name", message: dict.householdNameRequired }])
      }
      onInput={req.onInput}
      noValidate
      className="flex flex-col gap-3"
    >
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
          aria-invalid={req.messageFor("name") ? true : undefined}
          aria-describedby={req.messageFor("name") ? fieldErrorId("first-household-name") : undefined}
        />
        <FieldError fieldId="first-household-name">{req.messageFor("name")}</FieldError>
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        <PendingLabel pending={pending} busy={dict.creating} idle={dict.create} />
      </Button>
    </form>
  );
}
