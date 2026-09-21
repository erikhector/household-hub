"use client";

// Informational (not consent) notice: every cookie/localStorage entry the app
// uses is either strictly necessary or a preference the user set themselves
// — see src/lib/cookie-inventory.ts — so there's nothing to opt out of and
// no consent gate. Non-blocking by design: the app is fully usable without
// dismissing it. If a non-exempt cookie (analytics, marketing, third-party)
// is ever added, this must be replaced by a real consent flow first.
//
// `acknowledged` is read server-side from the ack cookie in the root layout
// (same pattern as the sidebar cookie in DashboardLayout), so a returning
// visitor never sees a flash of the notice before hydration.

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { COOKIE_NOTICE_COOKIE, COOKIE_NOTICE_COOKIE_MAX_AGE } from "@/lib/cookie-inventory";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export function CookieNotice({
  dict,
  acknowledged,
}: {
  dict: Dictionary["cookieNotice"];
  acknowledged: boolean;
}) {
  const [dismissed, setDismissed] = useState(acknowledged);
  const pathname = usePathname();

  if (dismissed) return null;

  // On phone-width dashboard pages the fixed BottomNav (z-40, ~4rem tall plus
  // the home-indicator inset) occupies the bottom edge, so sit above it
  // rather than covering the primary navigation.
  const aboveBottomNav = pathname.startsWith("/dashboard");

  function acknowledge() {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${COOKIE_NOTICE_COOKIE}=1; path=/; max-age=${COOKIE_NOTICE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
    setDismissed(true);
  }

  return (
    <div
      role="region"
      aria-label={dict.title}
      className={cn(
        "fixed inset-x-3 z-40 flex flex-col gap-3 rounded-xl border bg-popover p-4 text-sm text-popover-foreground shadow-lg sm:inset-x-auto sm:bottom-4 sm:left-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:flex-row sm:items-center",
        aboveBottomNav
          ? "bottom-[calc(4.75rem+env(safe-area-inset-bottom))]"
          : "bottom-[max(0.75rem,env(safe-area-inset-bottom))]",
      )}
    >
      <p className="flex-1 leading-relaxed text-muted-foreground">
        {dict.message}{" "}
        <Link href="/privacy#cookies" className="text-foreground underline underline-offset-4">
          {dict.learnMore}
        </Link>
      </p>
      <Button size="sm" onClick={acknowledge} className="shrink-0">
        {dict.dismiss}
      </Button>
    </div>
  );
}
