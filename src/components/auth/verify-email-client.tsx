"use client";

import { useActionState, useEffect, useRef } from "react";
import { CheckCircle2, MailCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusCard, StatusCardLink } from "@/components/auth/status-card";
import { verifyEmailAction, type VerifyEmailState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

const initialState: VerifyEmailState = {};

export function VerifyEmailClient({
  token,
  brand,
  isAuthenticated,
  dict,
}: {
  token: string;
  brand: string;
  isAuthenticated: boolean;
  dict: Dictionary["auth"]["verifyEmail"];
}) {
  const [state, formAction, pending] = useActionState(verifyEmailAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  // Auto-submit on mount so a user who clicks the emailed link sees the
  // result immediately, with no extra click needed — see this page's
  // server-component comment for why the actual write still happens inside
  // this real <form>'s Server Action rather than during render. Keeping a
  // real <form> (instead of calling the action straight from this effect)
  // means the visible button below still works with JS disabled, or if the
  // auto-submit is ever skipped.
  useEffect(() => {
    formRef.current?.requestSubmit();
  }, []);

  if (state.status === "verified" || state.status === "alreadyVerified") {
    return (
      <StatusCard brand={brand} icon={CheckCircle2} tone="success" title={dict.pageTitle}>
        <p className="text-sm text-muted-foreground">
          {state.status === "verified" ? dict.verifiedDescription : dict.alreadyVerifiedDescription}
        </p>
        <StatusCardLink href="/dashboard">{dict.goToDashboard}</StatusCardLink>
      </StatusCard>
    );
  }

  if (state.error) {
    return (
      <StatusCard brand={brand} icon={XCircle} tone="error" title={dict.pageTitle}>
        <p className="text-sm text-muted-foreground">{state.error}</p>
        <StatusCardLink href={isAuthenticated ? "/dashboard" : "/login"}>
          {isAuthenticated ? dict.dashboardResendLink : dict.loginToResendLink}
        </StatusCardLink>
      </StatusCard>
    );
  }

  return (
    <StatusCard brand={brand} icon={MailCheck} tone="neutral" title={dict.pageTitle}>
      <form ref={formRef} action={formAction} className="flex flex-col items-center gap-4">
        <input type="hidden" name="token" value={token} />
        <p className="text-sm text-muted-foreground">{dict.verifying}</p>
        <Button type="submit" disabled={pending} variant="outline">
          {dict.submit}
        </Button>
      </form>
    </StatusCard>
  );
}
