"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getClientLocale } from "@/lib/i18n/client-locale";

const COPY = {
  en: {
    title: "Something went wrong",
    body: "An unexpected error occurred. You can try again, or head back to the dashboard.",
    tryAgain: "Try again",
    backHome: "Back to dashboard",
  },
  sv: {
    title: "Något gick fel",
    body: "Ett oväntat fel inträffade. Du kan försöka igen, eller gå tillbaka till översikten.",
    tryAgain: "Försök igen",
    backHome: "Till översikten",
  },
} as const;

// Segment-level error boundary — catches anything an uncaught throw in a
// Server/Client Component render, or an unhandled exception from a Server
// Action invoked via useActionState/startTransition, would otherwise leave
// as Next.js's default unstyled crash page. Every action in this app is
// expected to return `{ error }` for known failure modes (see ActionState
// in src/lib/actions/auth.ts) — this is only the fallback for the
// unexpected kind (DB hiccup, etc).
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Logging is a real side effect (not a state sync), so it stays in an
  // effect — but the locale itself is read directly at render time (see
  // getClientLocale) rather than via setState-in-effect, since it can only
  // ever differ from the server-rendered default ("en") on the client. That
  // one-render text mismatch is expected and intentionally suppressed here,
  // the same tradeoff RootLayout already makes for the theme class.
  useEffect(() => {
    console.error(error);
    // No-op without a prior Sentry.init() call, i.e. without
    // NEXT_PUBLIC_SENTRY_DSN set — see src/instrumentation-client.ts.
    Sentry.captureException(error);
  }, [error]);

  const copy = COPY[getClientLocale()];

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl" suppressHydrationWarning>
            <TriangleAlert className="size-5 shrink-0 text-destructive" />
            {copy.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground" suppressHydrationWarning>
            {copy.body}
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
