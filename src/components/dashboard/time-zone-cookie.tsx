"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TIME_ZONE_COOKIE, TIME_ZONE_COOKIE_MAX_AGE } from "@/lib/time-zone";

/**
 * Keeps the `time_zone` cookie equal to the browser's zone (UX-137) so the
 * server can work out the user's local day. Renders nothing. When the cookie
 * is missing or stale the page that was just served used the wrong zone; only
 * the two pages that read it (the overview and Tasks) refresh once to
 * re-render with the right one. Every other page picks the cookie up on its
 * next navigation, so a first visit elsewhere isn't re-rendered under the
 * user's hands.
 */
export function TimeZoneCookie({ current }: { current: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const readsZone = pathname === "/dashboard" || pathname === "/dashboard/tasks";
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zone || zone === current) return;
    document.cookie = `${TIME_ZONE_COOKIE}=${encodeURIComponent(zone)}; path=/; max-age=${TIME_ZONE_COOKIE_MAX_AGE}; samesite=lax`;
    if (readsZone) router.refresh();
  }, [current, router, readsZone]);
  return null;
}
