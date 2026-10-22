"use client";

import { useActionState, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { User, Home, Mail, Lock, Sparkles, MailCheck, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/auth/password-input";
import { FieldError, fieldErrorId } from "@/components/auth/field-error";
import { useKeptFormValues } from "@/components/shared/use-kept-form-values";
import {
  signupAction,
  resendVerificationEmailForLoginAction,
  type SignupState,
  type ResendVerificationForLoginState,
} from "@/lib/actions/auth";
import { loginPath } from "@/lib/login-path";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { PendingLabel } from "@/components/ui/pending-label";

const initialState: SignupState = {};
const initialResendState: ResendVerificationForLoginState = {};

type Field = NonNullable<SignupState["field"]>;
type FieldErrors = Partial<Record<Field, string>>;

// Top to bottom, so focus lands on the first field that needs fixing.
const FIELD_ORDER: Field[] = ["displayName", "householdName", "email", "password", "confirmPassword"];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// UX-59: checked in the browser before the action runs, so a mistake is
// worded in the page's language (the server's messages are English-only,
// MAINT-7), sits under its field, and costs nothing the user typed. A
// mismatch used to round-trip to the server, and React then reset the form,
// wiping both passwords. The server still validates everything (signupSchema).
function validate(data: FormData, dict: Dictionary["auth"]["signup"]): FieldErrors {
  const text = (name: string) => {
    const value = data.get(name);
    return typeof value === "string" ? value : "";
  };
  const errors: FieldErrors = {};
  if (!text("displayName").trim()) errors.displayName = dict.nameRequired;
  if (!text("householdName").trim()) errors.householdName = dict.householdNameRequired;
  if (!EMAIL_PATTERN.test(text("email").trim())) errors.email = dict.emailInvalid;
  const password = text("password");
  if (password.length < 8) errors.password = dict.passwordTooShort;
  if (!text("confirmPassword")) errors.confirmPassword = dict.confirmRequired;
  else if (password !== text("confirmPassword")) errors.confirmPassword = dict.passwordsDontMatch;
  return errors;
}

// The ids of the elements describing a field: the always-visible hint (if
// it has one) and its error (when there is one).
function describedBy(field: string, hint: boolean, hasError: boolean) {
  return [hint ? `${field}-hint` : null, hasError ? fieldErrorId(field) : null].filter(Boolean).join(" ") || undefined;
}

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
  // docs/archive/UX_AUDIT_IMPLEMENTATION_PLAN.md) or because the email just never
  // arrived — without a full page reload (A4). Enumeration-safe: the caller
  // already knows this is their own email, but this reuses the same action
  // LoginForm's unverified-login flow uses either way.
  const [resendState, resendFormAction, resendPending] = useActionState(
    resendVerificationEmailForLoginAction,
    initialResendState,
  );
  // UX-13: an "email already in use" error mustn't wipe the name, household
  // and email (the passwords still clear — see useKeptFormValues).
  const kept = useKeptFormValues(["displayName", "householdName", "email"]);
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});

  // A blocked submit shows only its own errors; otherwise the last server
  // verdict stands until the next result.
  const blocked = Object.keys(clientErrors).length > 0;
  const serverField = blocked ? undefined : state.field;
  const errors: FieldErrors = blocked
    ? clientErrors
    : state.field
      ? { [state.field]: state.code === "email-taken" ? dict.emailTaken : state.error }
      : {};
  // An error with no field (rate limit, a database failure) keeps the
  // general line above the consent text.
  const generalError = !blocked && !state.field ? state.error : undefined;

  // Server-side rejections (a taken email, or the no-JS path) move focus to
  // the offending field once the result lands.
  useEffect(() => {
    if (state.field) document.getElementById(state.field)?.focus();
  }, [state]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const found = validate(new FormData(event.currentTarget), dict);
    setClientErrors(found);
    const first = FIELD_ORDER.find((field) => found[field]);
    if (first) {
      // Stops React running the form action, so nothing is reset.
      event.preventDefault();
      document.getElementById(first)?.focus();
      return;
    }
    kept.onSubmit(event);
  }

  const invalid = (field: Field) => (errors[field] ? true : undefined);

  const signupForm = (
    <form action={formAction} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{dict.joinHint}</p>
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
            defaultValue={kept.values.displayName}
            aria-invalid={invalid("displayName")}
            aria-describedby={describedBy("displayName", false, !!errors.displayName)}
            className="pl-8"
          />
        </div>
        <FieldError fieldId="displayName">{errors.displayName}</FieldError>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="householdName">{dict.householdName}</Label>
        <div className="relative">
          <Home className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoComplete="off"
            id="householdName"
            name="householdName"
            required
            maxLength={60}
            placeholder={dict.householdNamePlaceholder}
            aria-invalid={invalid("householdName")}
            aria-describedby={describedBy("householdName", true, !!errors.householdName)}
            defaultValue={kept.values.householdName}
            className="pl-8"
          />
        </div>
        <p id="householdName-hint" className="text-sm text-muted-foreground">
          {dict.householdNameHint}
        </p>
        <FieldError fieldId="householdName">{errors.householdName}</FieldError>
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
            aria-invalid={invalid("email")}
            aria-describedby={describedBy("email", false, !!errors.email)}
            className="pl-8"
          />
        </div>
        <FieldError fieldId="email">{errors.email}</FieldError>
        {serverField === "email" && state.code === "email-taken" && (
          <div className="flex flex-wrap gap-x-4 text-sm">
            <Link
              href={loginPath(kept.values.email)}
              className="touch-target font-medium text-primary underline underline-offset-4"
            >
              {dict.emailTakenLogIn}
            </Link>
            <Link
              href="/forgot-password"
              className="touch-target font-medium text-primary underline underline-offset-4"
            >
              {dict.emailTakenForgot}
            </Link>
          </div>
        )}
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
          aria-invalid={invalid("password")}
          aria-describedby={describedBy("password", true, !!errors.password)}
          showLabel={dict.showPassword}
          hideLabel={dict.hidePassword}
        />
        <p id="password-hint" className="text-sm text-muted-foreground">
          {dict.passwordHint}
        </p>
        <FieldError fieldId="password">{errors.password}</FieldError>
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
          aria-invalid={invalid("confirmPassword")}
          aria-describedby={describedBy("confirmPassword", false, !!errors.confirmPassword)}
          showLabel={dict.showPassword}
          hideLabel={dict.hidePassword}
        />
        <FieldError fieldId="confirmPassword">{errors.confirmPassword}</FieldError>
      </div>
      {generalError && (
        <p role="alert" className="text-sm text-destructive">
          {generalError}
        </p>
      )}
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
      <p className="text-center text-sm text-muted-foreground">
        {dict.haveAccount}{" "}
        <Link href="/login" className="font-medium text-primary underline underline-offset-4">
          {dict.logIn}
        </Link>
      </p>
    </form>
  );

  // The account now exists but can't sign in until its email is verified
  // (see signupAction's doc comment in src/lib/actions/auth.ts) — swap the
  // form out for this confirmation instead of the old auto-sign-in redirect.
  // UX-61: the card's title follows the step. Once the account exists it
  // says what to do next ("Check your inbox"), or just that the account is
  // made when the email itself failed to send.
  const sent = state.status === "verification-sent";
  const title = !sent
    ? dict.pageTitle
    : state.emailError
      ? dict.accountCreatedTitle
      : dict.checkInboxTitle;

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle as="h1" className="text-xl">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {sent ? (
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
            <Link
              href={loginPath(state.email)}
              className="text-sm font-medium text-primary underline underline-offset-4"
            >
              {dict.logIn}
            </Link>
          </div>
        ) : (
          signupForm
        )}
      </CardContent>
    </Card>
  );
}
