"use client";

import { useEffect } from "react";
import { toast } from "sonner";

// UX-135: the one-time "Welcome to Squirrel, {name}" a new user sees after
// the verification link signs them in. The link lands on /dashboard?welcome=1;
// the flag is dropped from the address right away (history.replaceState, so
// no navigation or refetch), so a reload or a shared URL doesn't greet them
// again. A stable toast id keeps React strict mode's double effect from
// stacking two toasts.
export function WelcomeToast({ message }: { message: string }) {
  useEffect(() => {
    toast.success(message, { id: "welcome" });
    const url = new URL(window.location.href);
    url.searchParams.delete("welcome");
    window.history.replaceState(window.history.state, "", url);
  }, [message]);
  return null;
}
