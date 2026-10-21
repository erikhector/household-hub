"use client";

import { useActionState } from "react";
import Link from "next/link";
import { KeyRound, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/auth/password-input";
import { resetPasswordAction, type ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { PendingLabel } from "@/components/ui/pending-label";

const initialState: ActionState = {};

export function ResetPasswordForm({
  token,
  email,
  dict,
}: {
  token: string;
  email: string;
  dict: Dictionary["auth"]["resetPassword"];
}) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      {/* UX-67: without a username field Chrome and iOS offer to save the new
          password with no account attached. The email names the login to update. */}
      <input type="hidden" name="email" value={email} autoComplete="username" />
      <div className="flex flex-col gap-2">
        <Label htmlFor="newPassword">{dict.newPassword}</Label>
        <PasswordInput
          id="newPassword"
          name="newPassword"
          icon={Lock}
          required
          minLength={8}
          maxLength={72}
          autoComplete="new-password"
          showLabel={dict.showPassword}
          hideLabel={dict.hidePassword}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirmPassword">{dict.confirmPassword}</Label>
        <PasswordInput
          enterKeyHint="go"
          id="confirmPassword"
          name="confirmPassword"
          icon={Lock}
          required
          minLength={8}
          maxLength={72}
          autoComplete="new-password"
          showLabel={dict.showPassword}
          hideLabel={dict.hidePassword}
        />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        <KeyRound className="size-4" />
        <PendingLabel pending={pending} busy={dict.saving} idle={dict.submit} />
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="touch-target font-medium text-primary underline underline-offset-4">
          {dict.backToLogin}
        </Link>
      </p>
    </form>
  );
}
