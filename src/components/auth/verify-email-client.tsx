"use client";

import { useActionState, useEffect, useRef } from "react";
import Link from "next/link";
import { CheckCircle2, MailCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { verifyEmailAction, type VerifyEmailState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

const initialState: VerifyEmailState = {};

export function VerifyEmailClient({
  token,
  isAuthenticated,
  dict,
}: {
  token: string;
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
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        <CheckCircle2 className="size-10 text-emerald-500" />
        <p className="text-sm text-muted-foreground">
          {state.status === "verified" ? dict.verifiedDescription : dict.alreadyVerifiedDescription}
        </p>
        <Link href="/dashboard" className="text-sm font-medium text-primary underline underline-offset-4">
          {dict.goToDashboard}
        </Link>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        <XCircle className="size-10 text-destructive" />
        <p className="text-sm text-muted-foreground">{state.error}</p>
        <Link
          href={isAuthenticated ? "/dashboard" : "/login"}
          className="text-sm font-medium text-primary underline underline-offset-4"
        >
          {isAuthenticated ? dict.dashboardResendLink : dict.loginToResendLink}
        </Link>
      </div>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="flex flex-col items-center gap-4 py-2 text-center">
      <input type="hidden" name="token" value={token} />
      <MailCheck className="size-10 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{dict.verifying}</p>
      <Button type="submit" disabled={pending} variant="outline">
        {dict.submit}
      </Button>
    </form>
  );
}
