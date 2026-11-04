"use client";

import { useEffect } from "react";

// PERF-31: the root layout can't read the locale for <html lang> itself
// (the locale comes from the account's preferences, a DB read, and reading
// it there would make the whole document request-bound, so nothing could be
// prerendered). It renders lang="en" and this sets the real one.
//
// The inline script runs as the streamed HTML is parsed, before any of the
// page's content paints, so screen readers and the browser's translate
// prompt see the right language from the start. The effect covers a language
// change in the same session (setLocaleAction refreshes the route, which
// re-renders this with the new locale but doesn't re-run the script).
// <html> carries suppressHydrationWarning, so React leaves the attribute the
// script set alone on hydration.
export function HtmlLang({ locale }: { locale: string }) {
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `document.documentElement.lang=${JSON.stringify(locale)}`,
      }}
    />
  );
}
