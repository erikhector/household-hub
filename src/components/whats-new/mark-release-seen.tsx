"use client";

// Rendered by the What's new page: records the newest version as seen so
// the sidebar/More-menu dot goes away. Set via document.cookie, same pattern
// as SIDEBAR_COOKIE in sidebar.tsx, because a Server Component can't write
// cookies. router.refresh() re-runs the dashboard layout so the dot clears
// right away instead of on the next navigation.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LAST_SEEN_RELEASE_COOKIE, LAST_SEEN_RELEASE_COOKIE_MAX_AGE } from "@/lib/release-notes";

export function MarkReleaseSeen({ version, alreadySeen }: { version: string; alreadySeen: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (alreadySeen) return;
    document.cookie = `${LAST_SEEN_RELEASE_COOKIE}=${version}; path=/; max-age=${LAST_SEEN_RELEASE_COOKIE_MAX_AGE}; SameSite=Lax`;
    router.refresh();
  }, [version, alreadySeen, router]);

  return null;
}
