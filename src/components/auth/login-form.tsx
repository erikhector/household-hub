"use client";

import { useActionState, useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { Mail, Lock, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/auth/password-input";
import { useKeptFormValues } from "@/components/shared/use-kept-form-values";
import {
  loginAction,
  resendVerificationEmailForLoginAction,
  type LoginState,
  type ResendVerificationForLoginState,
} from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { PendingLabel } from "@/components/ui/pending-label";

const initialState: LoginState = {};
const initialResendState: ResendVerificationForLoginState = {};

// No-op subscribe: the "next" query param never changes after the initial
// client render, so there's nothing to subscribe to — this just needs a
// stable function reference (won't re-subscribe every render).
function subscribe() {
  return () => {};
}

export function LoginForm({
  dict,
  initialEmail,
}: {
  dict: Dictionary["auth"]["login"];
  // UX-61: from `?email=` after verifying an email or resetting a password.
  initialEmail?: string;
}) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);
  const [resendState, resendFormAction, resendPending] = useActionState(
    resendVerificationEmailForLoginAction,
    initialResendState,
  );
  // UX-13: a wrong password keeps the email filled in.
  const kept = useKeptFormValues(["email"]);
  // Read client-side (rather than via a `next`/`callbackUrl` prop threaded
  // down from src/app/login/page.tsx) so a deep link followed while logged
  // out lands back where it was headed after login — see proxy.ts, which
  // sets this param, and A5 in docs/archive/UX_AUDIT_IMPLEMENTATION_PLAN.md.
  // useSyncExternalStore (not useState+useEffect) reports "" during
  // SSR/first client render, matching server markup, then the real value
  // from then on — no setState-in-effect, no hydration mismatch, no
  // Suspense boundary around useSearchParams() needed in a page this scope
  // doesn't touch.
  const nextPath = useSyncExternalStore(
    subscribe,
    () => new URLSearchParams(window.location.search).get("next") ?? "",
    () => "",
  );

  // UX-59: the error sits under the password field (the credential that was
  // rejected, or the one a throttle is waiting on), tied to it for screen
  // readers, and focus goes back there so a retry is one keystroke away.
  useEffect(() => {
    if (state.error) document.getElementById("password")?.focus();
  }, [state]);

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} onSubmit={kept.onSubmit} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={nextPath} />
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
              defaultValue={kept.values.email ?? initialEmail}
              className="pl-8"
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">{dict.password}</Label>
            <Link
              href="/forgot-password"
              className="touch-target text-xs font-medium text-primary underline underline-offset-4"
            >
              {dict.forgotPassword}
            </Link>
          </div>
          <PasswordInput
            enterKeyHint="go"
            id="password"
            name="password"
            icon={Lock}
            required
            maxLength={72}
            autoComplete="current-password"
            showLabel={dict.showPassword}
            hideLabel={dict.hidePassword}
            aria-invalid={state.error ? true : undefined}
            aria-describedby={state.error ? "password-error" : undefined}
          />
          {state.error && (
            <p id="password-error" role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          )}
        </div>
        <Button type="submit" disabled={pending} className="w-full">
          <LogIn className="size-4" />
          <PendingLabel pending={pending} busy={dict.loggingIn} idle={dict.submit} />
        </Button>
      </form>
      {/* Only shown once loginAction reports a correct password on an
          unverified account (state.unverifiedEmail) — a separate sibling
          <form> since HTML forms can't nest. See resendVerificationEmailForLoginAction
          in src/lib/actions/auth.ts for why this stays enumeration-safe. */}
      {state.unverifiedEmail &&
        (resendState.message ? (
          <p className="text-center text-sm text-muted-foreground">{resendState.message}</p>
        ) : (
          <form action={resendFormAction}>
            <input type="hidden" name="email" value={state.unverifiedEmail} />
            <Button type="submit" variant="outline" disabled={resendPending} className="w-full">
              {resendPending ? dict.resendingVerification : dict.resendVerification}
            </Button>
          </form>
        ))}
      <p className="text-center text-sm text-muted-foreground">
        {dict.noAccount}{" "}
        <Link href="/signup" className="font-medium text-primary underline underline-offset-4">
          {dict.signUp}
        </Link>
      </p>
    </div>
  );
}
