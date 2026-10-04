"use client";

import { useEffect } from "react";
import { logger } from "@/lib/logger";
import { captureClientException } from "@/lib/sentry-client";

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

  return (
    <html lang="en">
      <body
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
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Something went wrong</h1>
        <p style={{ color: "#666", maxWidth: "24rem" }}>
          An unexpected error occurred. Please try again.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            padding: "0.5rem 1rem",
            borderRadius: "0.5rem",
            border: "1px solid #ccc",
            background: "none",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
