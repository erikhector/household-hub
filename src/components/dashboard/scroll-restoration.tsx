"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { installScrollMemory, routeCommitted } from "@/components/dashboard/scroll-memory";

/**
 * UX-193: makes Back and Forward land where the reader left, on every
 * dashboard page (see scroll-memory.ts for why the browser can't). Rendered
 * once in the dashboard shell; renders nothing. Its effect runs each time
 * the pathname or the search string changes, which is when React has
 * committed the page a Back landed on.
 */
export function ScrollRestoration() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    installScrollMemory();
    routeCommitted();
  }, [pathname, search]);
  return null;
}
