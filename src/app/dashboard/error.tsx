"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { RotateCw, TriangleAlert, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getClientLocale } from "@/lib/i18n/client-locale";
import { logger } from "@/lib/logger";
import { captureClientException } from "@/lib/sentry-client";

// Same hand-rolled en/sv copy as src/app/error.tsx: an error boundary can't
// rely on the server-side dictionary loader, which may be what just threw.
const COPY = {
  en: {
    title: "This page hit a problem",
    body: "Something went wrong loading this part of Squirrel. The rest of the app still works, so you can try again or open another page from the menu.",
    offlineTitle: "You're offline",
    offlineBody: "This page needs a connection. Check your signal or Wi-Fi, then try again.",
    tryAgain: "Try again",
    backHome: "Back to dashboard",
  },
  sv: {
    title: "Den här sidan stötte på ett problem",
    body: "Något gick fel när den här delen av Squirrel laddades. Resten av appen fungerar, så du kan försöka igen eller öppna en annan sida från menyn.",
    offlineTitle: "Du är offline",
    offlineBody: "Den här sidan behöver uppkoppling. Kontrollera din täckning eller ditt wifi och försök igen.",
    tryAgain: "Försök igen",
    backHome: "Till översikten",
  },
} as const;

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

// Boundary for everything under /dashboard. Because it sits below
// dashboard/layout.tsx, a crash in one feature page replaces only the page
// content: the sidebar / bottom bar stay mounted, so the user can move to
// another feature instead of being stranded on the root error page (which
// replaces the whole shell). When the device is offline the failure is almost
// certainly the network, so say that instead of a generic "something broke".
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error("Unhandled dashboard error boundary", { error });
    void captureClientException(error);
  }, [error]);

  // Server snapshot is "online" so the first render matches SSR.
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  const copy = COPY[getClientLocale()];
  const Icon = online ? TriangleAlert : WifiOff;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-12">
      <Card className="w-full max-w-sm" role="alert">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl" suppressHydrationWarning>
            <Icon className="size-5 shrink-0 text-destructive" />
            {online ? copy.title : copy.offlineTitle}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground" suppressHydrationWarning>
            {online ? copy.body : copy.offlineBody}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={reset} suppressHydrationWarning>
              <RotateCw className="size-4" />
              {copy.tryAgain}
            </Button>
            <Button
              type="button"
              variant="outline"
              render={<Link href="/dashboard" />}
              suppressHydrationWarning
            >
              {copy.backHome}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
