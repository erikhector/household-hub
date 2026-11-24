"use client";

import { useActionState, type FormEvent } from "react";
import Link from "next/link";
import { Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordResetAction, type RequestPasswordResetState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { PendingLabel } from "@/components/ui/pending-label";
import { FieldError, fieldErrorId } from "@/components/auth/field-error";
import { useRequiredFields } from "@/components/shared/use-required-fields";
import { useKeptFormValues } from "@/components/shared/use-kept-form-values";
import { guardFormAction } from "@/components/shared/guard-form-action";

const initialState: RequestPasswordResetState = {};

export function ForgotPasswordForm({
  dict,
  requestFailed,
}: {
  dict: Dictionary["auth"]["forgotPassword"];
  /** `errors.requestFailed`, for a request that never arrives (UX-210). */
  requestFailed: string;
}) {
  // UX-210: a dropped connection is an error line, not the crash page.
  const [state, formAction, pending] = useActionState(
    guardFormAction(requestPasswordResetAction, requestFailed),
    initialState,
  );
  // UX-210: an error (a lost request, a malformed email) keeps the email,
  // as on /login (UX-13), so trying again is one tap.
  const kept = useKeptFormValues(["email"]);
  // UX-183b: a missing email is worded under the field in the page's
  // language (`noValidate`), not by the browser's own bubble. A malformed one
  // still reaches the server, which words that too.
  const req = useRequiredFields();
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (!req.check(event, [{ name: "email", id: "email", message: dict.emailRequired }])) kept.onSubmit(event);
  }

  // Once a request goes through — including for an email with no matching
  // account, see requestPasswordResetAction's doc comment — swap the form
  // out for the same generic confirmation either way. Never re-show the
  // form as if it failed; that distinction is exactly what this flow must
  // not leak.
  if (state.message) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{state.message}</p>
        <Link
          href="/login"
          className="touch-target justify-center text-sm font-medium text-primary underline underline-offset-4"
        >
          {dict.backToLogin}
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} onSubmit={onSubmit} onInput={req.onInput} noValidate className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{dict.description}</p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{dict.email}</Label>
        <div className="relative">
          <Mail className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            enterKeyHint="go"
            id="email"
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            defaultValue={kept.values.email}
            aria-invalid={req.messageFor("email") ? true : undefined}
            aria-describedby={req.messageFor("email") ? fieldErrorId("email") : undefined}
            className="pl-8"
          />
        </div>
        <FieldError fieldId="email">{req.messageFor("email")}</FieldError>
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        <Send className="size-4" />
        <PendingLabel pending={pending} busy={dict.sending} idle={dict.submit} />
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="touch-target font-medium text-primary underline underline-offset-4">
          {dict.backToLogin}
        </Link>
      </p>
    </form>
  );
}
