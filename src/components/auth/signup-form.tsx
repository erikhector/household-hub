"use client";

import { useActionState, useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { User, Home, Mail, Lock, Sparkles, MailCheck, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/auth/password-input";
import { useKeptFormValues } from "@/components/shared/use-kept-form-values";
import {
  signupAction,
  resendVerificationEmailForLoginAction,
  type SignupState,
  type ResendVerificationForLoginState,
} from "@/lib/actions/auth";
import { loginPath } from "@/lib/login-path";
import { validateSignupFields, type SignupField } from "@/lib/signup-validation";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { PendingLabel } from "@/components/ui/pending-label";

const initialState: SignupState = {};
const initialResendState: ResendVerificationForLoginState = {};

// UX-59: one field's error, under the field and tied to it for screen
// readers (role="alert" announces it when it appears).
function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
      {children}
    </p>
  );
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
  // UX-59: mistakes the browser can see are caught before the action runs.
  // A submit that reaches the server and comes back with an error makes
  // React reset the form and wipe both password fields; stopping it here
  // keeps everything typed. A server error stays until the field it names
  // is edited (`dismissedFor` is the state object that was dismissed).
  const [clientError, setClientError] = useState<{ field: SignupField; message: string } | null>(
    null,
  );
  const [dismissedFor, setDismissedFor] = useState<SignupState | null>(null);
  const serverError = dismissedFor === state ? undefined : state.error;
  const serverField = serverError ? state.field : undefined;
  const fieldError = (field: SignupField): string | undefined => {
    if (clientError) return clientError.field === field ? clientError.message : undefined;
    if (serverField !== field) return undefined;
    return state.emailTaken ? dict.emailTaken : serverError;
  };
  const formError = clientError || serverField ? undefined : serverError;

  // A server error about a field moves focus to it, like the client check.
  useEffect(() => {
    if (state.field) document.getElementById(state.field)?.focus();
  }, [state]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const formData = new FormData(event.currentTarget);
    const text = (name: SignupField) => String(formData.get(name) ?? "");
    const problem = validateSignupFields(
      {
        displayName: text("displayName"),
        householdName: text("householdName"),
        email: text("email"),
        password: text("password"),
        confirmPassword: text("confirmPassword"),
      },
      dict,
    );
    setClientError(problem);
    if (problem) {
      event.preventDefault();
      document.getElementById(problem.field)?.focus();
      return;
    }
    kept.onSubmit(event);
  }

  // Props every field shares so an error is wired up the same way: invalid
  // state, the message (and, where there is one, the hint) as its
  // description, and clearing the error once the user edits that field.
  const fieldProps = (field: SignupField, hintId?: string) => {
    const error = fieldError(field);
    const describedBy = [error ? `${field}-error` : null, hintId].filter(Boolean).join(" ");
    return {
      "aria-invalid": error ? true : undefined,
      "aria-describedby": describedBy || undefined,
      onChange: () => {
        if (clientError?.field === field) setClientError(null);
        if (serverField === field) setDismissedFor(state);
      },
    };
  };

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
            className="pl-8"
            {...fieldProps("displayName")}
          />
        </div>
        {fieldError("displayName") && <FieldError id="displayName">{fieldError("displayName")}</FieldError>}
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
            defaultValue={kept.values.householdName}
            className="pl-8"
            {...fieldProps("householdName", "householdName-hint")}
          />
        </div>
        {fieldError("householdName") && (
          <FieldError id="householdName">{fieldError("householdName")}</FieldError>
        )}
        <p id="householdName-hint" className="text-sm text-muted-foreground">
          {dict.householdNameHint}
        </p>
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
            {...fieldProps("email")}
          />
        </div>
        {fieldError("email") && (
          <FieldError id="email">
            {fieldError("email")}
            {state.emailTaken && !clientError && (
              <>
                {" "}
                <Link href={loginPath(kept.values.email)} className="font-medium underline underline-offset-4">
                  {dict.emailTakenLogIn}
                </Link>
                {" · "}
                <Link href="/forgot-password" className="font-medium underline underline-offset-4">
                  {dict.emailTakenForgot}
                </Link>
              </>
            )}
          </FieldError>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">{dict.password}</Label>
        <PasswordInput
          id="password"
          name="password"
          icon={Lock}
          required
          maxLength={72}
          autoComplete="new-password"
          showLabel={dict.showPassword}
          hideLabel={dict.hidePassword}
          {...fieldProps("password", "password-hint")}
        />
        <p id="password-hint" className="text-sm text-muted-foreground">
          {dict.passwordHint}
        </p>
        {fieldError("password") && <FieldError id="password">{fieldError("password")}</FieldError>}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirmPassword">{dict.confirmPassword}</Label>
        <PasswordInput
          enterKeyHint="go"
          id="confirmPassword"
          name="confirmPassword"
          icon={Lock}
          required
          maxLength={72}
          autoComplete="new-password"
          showLabel={dict.showPassword}
          hideLabel={dict.hidePassword}
          {...fieldProps("confirmPassword")}
        />
        {fieldError("confirmPassword") && (
          <FieldError id="confirmPassword">{fieldError("confirmPassword")}</FieldError>
        )}
      </div>
      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
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
