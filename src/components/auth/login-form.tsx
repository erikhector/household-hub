"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Mail, Lock, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  loginAction,
  resendVerificationEmailForLoginAction,
  type LoginState,
  type ResendVerificationForLoginState,
} from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

const initialState: LoginState = {};
const initialResendState: ResendVerificationForLoginState = {};

export function LoginForm({ dict }: { dict: Dictionary["auth"]["login"] }) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);
  const [resendState, resendFormAction, resendPending] = useActionState(
    resendVerificationEmailForLoginAction,
    initialResendState,
  );

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-4">
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
              className="pl-8"
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">{dict.password}</Label>
            <Link
              href="/forgot-password"
              className="text-xs font-medium text-primary underline underline-offset-4"
            >
              {dict.forgotPassword}
            </Link>
          </div>
          <div className="relative">
            <Lock className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="password"
              name="password"
              type="password"
              required
              maxLength={72}
              autoComplete="current-password"
              className="pl-8"
            />
          </div>
        </div>
        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        <Button type="submit" disabled={pending} className="w-full">
          <LogIn className="size-4" />
          {pending ? dict.loggingIn : dict.submit}
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
