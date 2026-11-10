"use client";

import { useActionState, type FormEvent } from "react";
import { Mail, Lock, MailWarning } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFormDirty } from "@/components/shared/use-form-dirty";
import { FieldError, fieldErrorId } from "@/components/auth/field-error";
import { useRequiredFields } from "@/components/shared/use-required-fields";
import { updateEmailAction } from "@/app/dashboard/profile/actions";
import { resendVerificationEmailAction, type ResendVerificationState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { PendingLabel } from "@/components/ui/pending-label";

type FormState = { error?: string };

const initialState: FormState = {};
const initialResendState: ResendVerificationState = {};

// Keeps the email-verification banner (see
// src/components/dashboard/email-verification-banner.tsx) reachable after
// someone dismisses it for the session — same resendVerificationEmailAction,
// surfaced here so "not verified" isn't only ever visible as chrome you can
// make disappear (docs/archive/UX_FRICTION_BACKLOG.md item 1).
export function EmailForm({
  email,
  verified,
  dict,
}: {
  email: string;
  verified: boolean;
  dict: Dictionary["profile"]["emailForm"];
}) {
  const [state, formAction, pending] = useActionState(async (
    prevState: FormState,
    formData: FormData,
  ): Promise<FormState> => {
    const result = await updateEmailAction(prevState, formData);
    if (result.error) return { error: result.error };
    toast.success(dict.saved);
    return {};
  }, initialState);
  const { dirty, formProps } = useFormDirty(pending);
  // UX-183b: a missing new email or password is worded under its field in the
  // page's language (`noValidate`), not by the browser's own bubble. A
  // malformed address still reaches the server, which words that too.
  const req = useRequiredFields();
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    req.check(event, [
      { name: "newEmail", id: "newEmail", message: dict.newEmailRequired },
      { name: "currentPassword", id: "currentPasswordForEmail", message: dict.currentPasswordRequired },
    ]);
  }
  const [resendState, resendFormAction, resendPending] = useActionState(
    resendVerificationEmailAction,
    initialResendState,
  );

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="font-heading text-base font-semibold">{dict.title}</h3>
        <p className="text-sm text-muted-foreground">{dict.description}</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="currentEmail">{dict.currentEmailLabel}</Label>
        <Input key={email} id="currentEmail" defaultValue={email} disabled />
        {!verified && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-warning">
            <MailWarning className="size-3.5 shrink-0" />
            <span>{resendState.sent ? dict.verificationSent : dict.notVerified}</span>
            <form action={resendFormAction}>
              <Button
                type="submit"
                variant="outline"
                size="sm"
                disabled={resendPending || resendState.sent}
                className="h-6 border-warning/30 bg-transparent px-2 text-xs text-warning hover:bg-warning/10"
              >
                {resendPending ? dict.resendingVerification : dict.resendVerification}
              </Button>
            </form>
          </div>
        )}
      </div>
      <form
        key={email}
        action={formAction}
        onSubmit={onSubmit}
        noValidate
        {...formProps}
        onInput={(event) => {
          formProps.onInput();
          req.onInput(event);
        }}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="newEmail">{dict.newEmailLabel}</Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="newEmail"
              name="newEmail"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              aria-invalid={req.messageFor("newEmail") ? true : undefined}
              aria-describedby={req.messageFor("newEmail") ? fieldErrorId("newEmail") : undefined}
              className="pl-8"
            />
          </div>
          <FieldError fieldId="newEmail">{req.messageFor("newEmail")}</FieldError>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="currentPasswordForEmail">{dict.currentPasswordLabel}</Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              enterKeyHint="go"
              id="currentPasswordForEmail"
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password"
              aria-invalid={req.messageFor("currentPassword") ? true : undefined}
              aria-describedby={req.messageFor("currentPassword") ? fieldErrorId("currentPasswordForEmail") : undefined}
              className="pl-8"
            />
          </div>
          <FieldError fieldId="currentPasswordForEmail">{req.messageFor("currentPassword")}</FieldError>
        </div>
        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        <Button type="submit" variant={dirty ? "default" : "secondary"} disabled={pending} className="self-start">
          <PendingLabel pending={pending} busy={dict.saving} idle={dict.save} />
        </Button>
      </form>
    </div>
  );
}
