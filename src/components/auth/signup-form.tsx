"use client";

import { useActionState } from "react";
import Link from "next/link";
import { User, Home, Mail, Lock, Sparkles, MailCheck, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/auth/password-input";
import {
  signupAction,
  resendVerificationEmailForLoginAction,
  type SignupState,
  type ResendVerificationForLoginState,
} from "@/lib/actions/auth";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

const initialState: SignupState = {};
const initialResendState: ResendVerificationForLoginState = {};

export function SignupForm({
  dict,
  legalDict,
}: {
  dict: Dictionary["auth"]["signup"];
  legalDict: Dictionary["legal"];
}) {
  const [state, formAction, pending] = useActionState(signupAction, initialState);
  // Lets the confirmation screen below offer a real retry — either because
  // the initial send failed (state.emailError, see A1 in
  // UX_AUDIT_IMPLEMENTATION_PLAN.md) or because the email just never
  // arrived — without a full page reload (A4). Enumeration-safe: the caller
  // already knows this is their own email, but this reuses the same action
  // LoginForm's unverified-login flow uses either way.
  const [resendState, resendFormAction, resendPending] = useActionState(
    resendVerificationEmailForLoginAction,
    initialResendState,
  );

  // The account now exists but can't sign in until its email is verified
  // (see signupAction's doc comment in src/lib/actions/auth.ts) — swap the
  // form out for this confirmation instead of the old auto-sign-in redirect.
  if (state.status === "verification-sent") {
    return (
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        {state.emailError ? (
          <AlertTriangle className="size-10 text-destructive" />
        ) : (
          <MailCheck className="size-10 text-muted-foreground" />
        )}
        <p className="text-sm text-muted-foreground">
          {state.emailError
            ? dict.verificationSendFailedDescription
            : format(dict.verificationSentDescription, { email: state.email ?? "" })}
        </p>
        {resendState.message ? (
          <p className="text-sm text-muted-foreground">{resendState.message}</p>
        ) : (
          <form action={resendFormAction}>
            <input type="hidden" name="email" value={state.email ?? ""} />
            <Button type="submit" variant="outline" disabled={resendPending}>
              {resendPending ? dict.resending : dict.resend}
            </Button>
          </form>
        )}
        <Link href="/login" className="text-sm font-medium text-primary underline underline-offset-4">
          {dict.logIn}
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="displayName">{dict.yourName}</Label>
        <div className="relative">
          <User className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="displayName"
            name="displayName"
            required
            maxLength={60}
            autoComplete="name"
            className="pl-8"
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="householdName">{dict.householdName}</Label>
        <div className="relative">
          <Home className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="householdName"
            name="householdName"
            required
            maxLength={60}
            placeholder={dict.householdNamePlaceholder}
            className="pl-8"
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{dict.email}</Label>
        <div className="relative">
          <Mail className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="email"
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            className="pl-8"
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">{dict.password}</Label>
        <PasswordInput
          id="password"
          name="password"
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
        <Sparkles className="size-4" />
        {pending ? dict.creating : dict.submit}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {dict.haveAccount}{" "}
        <Link href="/login" className="font-medium text-primary underline underline-offset-4">
          {dict.logIn}
        </Link>
      </p>
    </form>
  );
}
