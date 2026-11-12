"use client";

import { useActionState, type FormEvent } from "react";
import Link from "next/link";
import { MailCheck, AlertTriangle, Lock, Mail, Sparkles, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { PasswordInput } from "@/components/auth/password-input";
import { useKeptFormValues } from "@/components/shared/use-kept-form-values";
import { FieldError, fieldErrorId } from "@/components/auth/field-error";
import { useRequiredFields } from "@/components/shared/use-required-fields";
import { joinViaInviteSignupAction } from "@/lib/actions/household";
import { resendVerificationEmailForLoginAction, type ResendVerificationForLoginState } from "@/lib/actions/auth";
import type { SignupState } from "@/lib/actions/auth";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { PendingLabel } from "@/components/ui/pending-label";

const initialState: SignupState = {};
const initialResendState: ResendVerificationForLoginState = {};

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
  // Same retry-without-reload treatment as SignupForm (A4 in
  // docs/archive/UX_AUDIT_IMPLEMENTATION_PLAN.md).
  const [resendState, resendFormAction, resendPending] = useActionState(
    resendVerificationEmailForLoginAction,
    initialResendState,
  );
  // UX-13, as in SignupForm: an error keeps the name and email.
  const kept = useKeptFormValues(["displayName", "email"]);
  // UX-183b: a missing name, email or password is worded under its field in
  // the page's language (`noValidate`), not by the browser's own bubble. The
  // server still owns the format rules (email shape, length, match).
  const req = useRequiredFields();
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const blocked = req.check(event, [
      { name: "displayName", id: "displayName", message: dict.nameRequired },
      { name: "email", id: "email", message: dict.emailRequired },
      { name: "password", id: "password", message: dict.passwordRequired },
      { name: "confirmPassword", id: "confirmPassword", message: dict.confirmPasswordRequired },
    ]);
    if (!blocked) kept.onSubmit(event);
  }
  const invalid = (name: string, id: string) => ({
    "aria-invalid": req.messageFor(name) ? (true as const) : undefined,
    "aria-describedby": req.messageFor(name) ? fieldErrorId(id) : undefined,
  });

  // Carries the invite forward through login (A5's redirect-back param) so
  // "log in, then reopen this invite link" is a real, working path instead
  // of a footnote the user has to act on manually — see A8 in
  // docs/archive/UX_AUDIT_IMPLEMENTATION_PLAN.md. loginAction returns here once signed
  // in, where JoinPage (src/app/join/[token]/page.tsx) then renders
  // AcceptInviteForm for an already-authenticated visitor.
  const loginHref = `/login?next=${encodeURIComponent(`/join/${token}`)}`;

  // Same reasoning as SignupForm's identical branch (src/components/auth/
  // signup-form.tsx): the account exists but can't sign in until its email
  // is verified (see joinViaInviteSignupAction's doc comment).
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
            ? format(dict.verificationSendFailedDescription, { household: state.householdName ?? "" })
            : format(dict.verificationSentDescription, {
                household: state.householdName ?? "",
                email: state.email ?? "",
              })}
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
    <form action={formAction} onSubmit={onSubmit} onInput={req.onInput} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="displayName">{dict.yourName}</Label>
        {/* Same icon-in-field styling as /signup (UX-62). */}
        <div className="relative">
          <User className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="displayName"
            name="displayName"
            required
            maxLength={60}
            autoComplete="name"
            defaultValue={kept.values.displayName}
            className="pl-8"
            {...invalid("displayName", "displayName")}
          />
        </div>
        <FieldError fieldId="displayName">{req.messageFor("displayName")}</FieldError>
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
            defaultValue={kept.values.email}
            className="pl-8"
            {...invalid("email", "email")}
          />
        </div>
        <FieldError fieldId="email">{req.messageFor("email")}</FieldError>
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
          {...invalid("password", "password")}
        />
        <FieldError fieldId="password">{req.messageFor("password")}</FieldError>
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
          {...invalid("confirmPassword", "confirmPassword")}
        />
        <FieldError fieldId="confirmPassword">{req.messageFor("confirmPassword")}</FieldError>
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <p className="text-center text-sm text-muted-foreground">
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
        <PendingLabel pending={pending} busy={dict.creating} idle={dict.submit} />
      </Button>
      {/* Equal visual weight with the "create account" path above — an
          existing account is a real, first-class way through this page, not
          a footnote (A8 in docs/archive/UX_AUDIT_IMPLEMENTATION_PLAN.md). */}
      <div className="flex items-center gap-2">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">{dict.orDivider}</span>
        <Separator className="flex-1" />
      </div>
      <Button variant="outline" className="w-full" render={<Link href={loginHref} />}>
        {dict.logIn}
      </Button>
      <p className="text-center text-sm text-muted-foreground">{dict.haveAccount}</p>
    </form>
  );
}
