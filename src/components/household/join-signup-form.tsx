"use client";

import { useActionState } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { joinViaInviteSignupAction } from "@/lib/actions/household";
import type { SignupState } from "@/lib/actions/auth";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

const initialState: SignupState = {};

export function JoinSignupForm({
  token,
  dict,
  legalDict,
}: {
  token: string;
  dict: Dictionary["auth"]["join"];
  legalDict: Dictionary["legal"];
}) {
  const [state, formAction, pending] = useActionState(joinViaInviteSignupAction, initialState);

  // Same reasoning as SignupForm's identical branch (src/components/auth/
  // signup-form.tsx): the account exists but can't sign in until its email
  // is verified (see joinViaInviteSignupAction's doc comment).
  if (state.status === "verification-sent") {
    return (
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        <MailCheck className="size-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {format(dict.verificationSentDescription, { email: state.email ?? "" })}
        </p>
        <Link href="/login" className="text-sm font-medium text-primary underline underline-offset-4">
          {dict.logIn}
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="displayName">{dict.yourName}</Label>
        <Input id="displayName" name="displayName" required maxLength={60} autoComplete="name" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{dict.email}</Label>
        <Input id="email" name="email" type="email" required maxLength={254} autoComplete="email" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">{dict.password}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          maxLength={72}
          autoComplete="new-password"
        />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <p className="text-center text-xs text-muted-foreground">
        {legalDict.signupConsentPrefix}{" "}
        <Link href="/terms" className="underline underline-offset-4 hover:text-foreground">
          {legalDict.termsLink}
        </Link>{" "}
        {legalDict.consentAnd}{" "}
        <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground">
          {legalDict.privacyLink}
        </Link>
        {legalDict.consentSuffix}
      </p>
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
