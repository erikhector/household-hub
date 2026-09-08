"use client";

import { useActionState } from "react";
import Link from "next/link";
import { KeyRound, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPasswordAction, type ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

const initialState: ActionState = {};

export function ResetPasswordForm({
  token,
  dict,
}: {
  token: string;
  dict: Dictionary["auth"]["resetPassword"];
}) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="newPassword">{dict.newPassword}</Label>
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
        <Label htmlFor="confirmPassword">{dict.confirmPassword}</Label>
        <div className="relative">
          <Lock className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
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
      <Button type="submit" disabled={pending} className="w-full">
        <KeyRound className="size-4" />
        {pending ? dict.saving : dict.submit}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-primary underline underline-offset-4">
          {dict.backToLogin}
        </Link>
      </p>
    </form>
  );
}
