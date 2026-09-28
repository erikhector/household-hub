"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useLogout } from "@/lib/push-client";

// A plain <form action={logoutAction}> can't also drop this browser's push
// subscription (SEC-5) — only client-side JS knows it (see push-client.ts)
// — so every logout entry point, including this one used from server
// components like no-household/page.tsx, goes through useLogout instead.
export function LogoutButton({ children, className }: { children: ReactNode; className?: string }) {
  const { logOut, pending } = useLogout();

  return (
    <Button type="button" variant="outline" className={className} disabled={pending} onClick={logOut}>
      {children}
    </Button>
  );
}
