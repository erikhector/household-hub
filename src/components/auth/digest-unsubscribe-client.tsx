"use client";

import { useActionState, useEffect, useRef } from "react";
import { CheckCircle2, MailX, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusCard, StatusCardLink } from "@/components/auth/status-card";
import { unsubscribeFromDigestAction, type DigestUnsubscribeState } from "@/lib/actions/digest";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

const initialState: DigestUnsubscribeState = {};

// GAP-27: the weekly digest's footer "Unsubscribe" link lands here. Same
// auto-submitting real <form> as VerifyEmailClient: one click in the email
// is all it takes, yet the write happens in a Server Action rather than on
// a GET — mail scanners that prefetch links run no JavaScript, so they never
// submit it. The visible button covers JS-disabled readers.
export function DigestUnsubscribeClient({
  token,
  brand,
  dict,
}: {
  token: string;
  brand: string;
  dict: Dictionary["digestUnsubscribe"];
}) {
  const [state, formAction, pending] = useActionState(unsubscribeFromDigestAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    formRef.current?.requestSubmit();
  }, []);

  if (state.status === "unsubscribed" || state.status === "invalid") {
    const done = state.status === "unsubscribed";
    return (
      <StatusCard
        brand={brand}
        icon={done ? CheckCircle2 : XCircle}
        tone={done ? "success" : "error"}
        title={done ? dict.pageTitle : dict.invalidTitle}
      >
        <p className="text-sm text-muted-foreground">{done ? dict.done : dict.invalid}</p>
        <StatusCardLink href="/dashboard/profile">{dict.profileLink}</StatusCardLink>
      </StatusCard>
    );
  }

  return (
    <StatusCard brand={brand} icon={MailX} tone="neutral" title={dict.pageTitle}>
      <form ref={formRef} action={formAction} className="flex flex-col items-center gap-4">
        <input type="hidden" name="token" value={token} />
        <p className="text-sm text-muted-foreground">
          {state.status === "error" ? dict.error : dict.working}
        </p>
        <Button type="submit" disabled={pending} variant="outline">
          {dict.submit}
        </Button>
      </form>
    </StatusCard>
  );
}
