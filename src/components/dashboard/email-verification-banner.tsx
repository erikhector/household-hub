"use client";

// Unobtrusive, dismissible-by-verifying-not-by-clicking-away banner shown
// only while the signed-in user's email is unverified (see
// src/app/dashboard/layout.tsx, which fetches User.emailVerifiedAt
// alongside requireHousehold() and only renders this when it's null). Soft
// gate only — see AGENTS.md's task L spec / PRODUCTION_READINESS.md: the
// rest of the dashboard stays fully usable regardless, this is purely a
// nudge with a resend action.

import { useActionState } from "react";
import { MailWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resendVerificationEmailAction, type ResendVerificationState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

const initialState: ResendVerificationState = {};

export function EmailVerificationBanner({ dict }: { dict: Dictionary["emailVerification"] }) {
  const [state, formAction, pending] = useActionState(resendVerificationEmailAction, initialState);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-sm text-amber-900 dark:text-amber-400">
      <MailWarning className="size-4 shrink-0" />
      <span className="flex-1">
        {state.sent ? dict.sent : state.error ? state.error : dict.message}
      </span>
      <form action={formAction}>
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={pending || state.sent}
          className="h-7 border-amber-500/30 bg-transparent text-xs text-amber-900 hover:bg-amber-500/10 dark:text-amber-400"
        >
          {pending ? dict.resending : dict.resend}
        </Button>
      </form>
    </div>
  );
}
