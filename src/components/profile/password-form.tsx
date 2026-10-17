"use client";

import { useActionState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFormDirty } from "@/components/shared/use-form-dirty";
import { updatePasswordAction } from "@/app/dashboard/profile/actions";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { PendingLabel } from "@/components/ui/pending-label";

const initialState: ActionState = {};

export function PasswordForm({
  email,
  dict,
}: {
  email: string;
  dict: Dictionary["profile"]["passwordForm"];
}) {
  const [state, formAction, pending] = useActionState(updatePasswordAction, initialState);
  const { dirty, formProps } = useFormDirty(pending);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="font-heading text-base font-semibold">{dict.title}</h3>
        <p className="text-sm text-muted-foreground">{dict.description}</p>
      </div>
      <form action={formAction} {...formProps} className="flex flex-col gap-4">
        {/* Username so password managers file the new password under the
            right account. It must be rendered (sr-only, not `hidden`, which is
            display:none and which managers skip) but kept out of the tab order
            and the accessibility tree. No `name`: the action doesn't read it. */}
        <input
          type="text"
          value={email}
          autoComplete="username"
          readOnly
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
        />
        <div className="flex flex-col gap-2">
          <Label htmlFor="currentPasswordForPassword">{dict.currentPasswordLabel}</Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="currentPasswordForPassword"
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password"
              className="pl-8"
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="newPassword">{dict.newPasswordLabel}</Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="newPassword"
              name="newPassword"
              type="password"
              required
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
              className="pl-8"
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="confirmPassword">{dict.confirmPasswordLabel}</Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              enterKeyHint="go"
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
              className="pl-8"
            />
          </div>
        </div>
        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        <Button type="submit" variant={dirty ? "default" : "secondary"} disabled={pending} className="self-start">
          <PendingLabel pending={pending} busy={dict.saving} idle={dict.save} />
        </Button>
      </form>
    </div>
  );
}
