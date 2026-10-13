"use client";

import { useEffect } from "react";
import { getClientLocale } from "@/lib/i18n/client-locale";
import { logger } from "@/lib/logger";
import { captureClientException } from "@/lib/sentry-client";

const COPY = {
  en: {
    title: "Something went wrong",
    body: "An unexpected error occurred. Please try again.",
    tryAgain: "Try again",
  },
  sv: {
    title: "Något gick fel",
    body: "Ett oväntat fel inträffade. Försök igen.",
    tryAgain: "Försök igen",
  },
} as const;

// Same tokens as globals.css (:root / .dark), restated here because this
// boundary renders when the root layout, and with it globals.css and
// next-themes, has failed. The OS colour scheme stands in for the theme
// toggle, so a dark-mode user isn't flashed a white page.
const STYLES = `
  :root {
    --background: oklch(0.98 0.008 300);
    --foreground: oklch(0.24 0.035 290);
    --muted-foreground: oklch(0.48 0.03 290);
    --border: oklch(0.88 0.02 290);
    color-scheme: light dark;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --background: oklch(0.145 0 0);
      --foreground: oklch(0.985 0 0);
      --muted-foreground: oklch(0.72 0.03 290);
      --border: oklch(1 0 0 / 10%);
    }
  }
  body { margin: 0; background: var(--background); color: var(--foreground); }
`;

// Only triggers if the root layout itself throws (vs. a page/segment error,
// which src/app/error.tsx already handles) — so this can't rely on
// ThemeProvider, fonts, or anything else RootLayout normally provides; it
// must render its own complete <html>/<body>. Kept deliberately plain.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error("Unhandled global error boundary", { error });
    // No-op without NEXT_PUBLIC_SENTRY_DSN set, and the SDK is only loaded
    // when it is — see src/lib/sentry-client.ts.
    void captureClientException(error);
  }, [error]);

  // Read at render like src/app/error.tsx does: the cookie can only differ
  // from the server-rendered default on the client, so that one mismatch is
  // expected and suppressed.
  const locale = getClientLocale();
  const copy = COPY[locale];

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <style>{STYLES}</style>
      </head>
      <body
        suppressHydrationWarning
        style={{
          display: "flex",
          minHeight: "100vh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "1.5rem",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>{copy.title}</h1>
        <p style={{ color: "var(--muted-foreground)", maxWidth: "24rem" }}>{copy.body}</p>
        <button
          type="button"
          onClick={reset}
          style={{
            minHeight: "2.75rem",
            padding: "0.5rem 1rem",
            borderRadius: "0.5rem",
            border: "1px solid var(--border)",
            background: "none",
            color: "inherit",
            cursor: "pointer",
          }}
        >
          {copy.tryAgain}
        </button>
      </body>
    </html>
  );
}
