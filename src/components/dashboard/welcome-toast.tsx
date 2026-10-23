"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";

// UX-135: the one-time "Welcome to Squirrel, {name}" a new user sees after
// the verification link signs them in. The link lands on /dashboard?welcome=1;
// the flag is dropped through the router right away (a bare
// history.replaceState gets overwritten by the App Router's own URL
// bookkeeping, which left `?welcome=1` in the address), so a reload or a
// shared URL doesn't greet them again. A stable toast id keeps React strict
// mode's double effect from stacking two toasts.
export function WelcomeToast({ message }: { message: string }) {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    toast.success(message, { id: "welcome" });
    router.replace(pathname, { scroll: false });
  }, [message, pathname, router]);
  return null;
}
