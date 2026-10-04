"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordResetAction, type RequestPasswordResetState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

const initialState: RequestPasswordResetState = {};

export function ForgotPasswordForm({ dict }: { dict: Dictionary["auth"]["forgotPassword"] }) {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, initialState);

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
          className="text-center text-sm font-medium text-primary underline underline-offset-4"
        >
          {dict.backToLogin}
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
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
            className="pl-8"
          />
        </div>
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        <Send className="size-4" />
        {pending ? dict.sending : dict.submit}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-primary underline underline-offset-4">
          {dict.backToLogin}
        </Link>
      </p>
    </form>
  );
}
