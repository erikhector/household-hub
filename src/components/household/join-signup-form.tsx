"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { joinViaInviteSignupAction } from "@/lib/actions/household";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

const initialState: ActionState = {};

export function JoinSignupForm({
  token,
  dict,
}: {
  token: string;
  dict: Dictionary["auth"]["join"];
}) {
  const [state, formAction, pending] = useActionState(joinViaInviteSignupAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="displayName">{dict.yourName}</Label>
        <Input id="displayName" name="displayName" required autoComplete="name" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{dict.email}</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">{dict.password}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? dict.creating : dict.submit}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {dict.haveAccount}{" "}
        <Link href="/login" className="underline underline-offset-4">
          {dict.logIn}
        </Link>{" "}
        {dict.logInSuffix}
      </p>
    </form>
  );
}
