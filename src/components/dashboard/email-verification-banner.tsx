"use client";

// Unobtrusive banner shown only while the signed-in user's email is
// unverified (see src/app/dashboard/layout.tsx, which fetches
// User.emailVerifiedAt alongside requireHousehold() and only renders this
// when it's null). Soft gate only — see AGENTS.md's task L spec /
// PRODUCTION_READINESS.md: the rest of the dashboard stays fully usable
// regardless, this is purely a nudge with a resend action.
//
// Dismissible via a session cookie (EMAIL_VERIFICATION_DISMISSED_COOKIE):
// mirrors the SIDEBAR_COOKIE pattern in src/components/dashboard/sidebar.tsx
// — set directly via document.cookie (no server action) and read back
// server-side in DashboardLayout. Deliberately has no max-age, so it's a
// true session cookie: the browser drops it when the session ends and the
// banner reappears next visit for as long as the account stays unverified,
// per UX_FRICTION_BACKLOG.md item 1's "remind me later" fix direction.
// EmailForm on the Profile page (src/components/profile/email-form.tsx)
// shows the same resend action for anyone who dismissed this and wants it
// back.

import { useActionState, useState } from "react";
import { MailWarning, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resendVerificationEmailAction, type ResendVerificationState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export const EMAIL_VERIFICATION_DISMISSED_COOKIE = "email_verification_dismissed";

const initialState: ResendVerificationState = {};

export function EmailVerificationBanner({ dict }: { dict: Dictionary["emailVerification"] }) {
  const [state, formAction, pending] = useActionState(resendVerificationEmailAction, initialState);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  function dismiss() {
    // No max-age: a session cookie, so it clears itself once the browser
    // session ends (see the file-level comment above for why that's the
    // right lifetime here).
    document.cookie = `${EMAIL_VERIFICATION_DISMISSED_COOKIE}=1; path=/`;
    setDismissed(true);
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-warning/20 bg-warning/10 px-4 py-2 text-sm text-warning">
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
          className="h-7 border-warning/30 bg-transparent text-xs text-warning hover:bg-warning/10"
        >
          {pending ? dict.resending : dict.resend}
        </Button>
      </form>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={dismiss}
        aria-label={dict.dismissAriaLabel}
        className="size-7 shrink-0 text-warning hover:bg-warning/10"
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
