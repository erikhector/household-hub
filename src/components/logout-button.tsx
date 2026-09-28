"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { logOut } from "@/lib/push-client";

// A plain <form action={logoutAction}> can't also drop this browser's push
// subscription (SEC-5) — only client-side JS knows the endpoint (see
// push-client.ts) — so every logout entry point, including this one used
// from server components like no-household/page.tsx, goes through here
// instead.
export function LogoutButton({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Button type="button" variant="outline" className={className} onClick={() => void logOut()}>
      {children}
    </Button>
  );
}
