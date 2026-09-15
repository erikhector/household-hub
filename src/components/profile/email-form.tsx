"use client";

import { useActionState } from "react";
import { Mail, Lock, MailWarning } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateEmailAction } from "@/app/dashboard/profile/actions";
import { resendVerificationEmailAction, type ResendVerificationState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type FormState = { error?: string };

const initialState: FormState = {};
const initialResendState: ResendVerificationState = {};

// Keeps the email-verification banner (see
// src/components/dashboard/email-verification-banner.tsx) reachable after
// someone dismisses it for the session — same resendVerificationEmailAction,
// surfaced here so "not verified" isn't only ever visible as chrome you can
// make disappear (UX_FRICTION_BACKLOG.md item 1).
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
  const [resendState, resendFormAction, resendPending] = useActionState(
    resendVerificationEmailAction,
    initialResendState,
  );

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="font-heading text-base font-semibold">{dict.title}</h2>
        <p className="text-sm text-muted-foreground">{dict.description}</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="currentEmail">{dict.currentEmailLabel}</Label>
        <Input key={email} id="currentEmail" defaultValue={email} disabled />
        {!verified && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-amber-900 dark:text-amber-400">
            <MailWarning className="size-3.5 shrink-0" />
            <span>{resendState.sent ? dict.verificationSent : dict.notVerified}</span>
            <form action={resendFormAction}>
              <Button
                type="submit"
                variant="outline"
                size="sm"
                disabled={resendPending || resendState.sent}
                className="h-6 border-amber-500/30 bg-transparent px-2 text-xs text-amber-900 hover:bg-amber-500/10 dark:text-amber-400"
              >
                {resendPending ? dict.resendingVerification : dict.resendVerification}
              </Button>
            </form>
          </div>
        )}
      </div>
      <form key={email} action={formAction} className="flex flex-col gap-4">
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
              className="pl-8"
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="currentPasswordForEmail">{dict.currentPasswordLabel}</Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="currentPasswordForEmail"
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password"
              className="pl-8"
            />
          </div>
        </div>
        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? dict.saving : dict.save}
        </Button>
      </form>
    </div>
  );
}
