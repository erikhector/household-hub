"use client";

// UX-39: a money figure that counts to its new value instead of jumping —
// flip the month, log a transaction, and the balance rolls over to the new
// number (Copilot Money's balances are the bar). Always `tabular-nums`, so
// the digits don't jitter sideways while they count.
//
// Only a *change* animates. The first render is the real value, exactly as
// the server rendered it: counting up from zero on every page load would
// flash the wrong number at a user who just wants to read it, and would put
// a moving target in front of anything that reads the page (tests, screen
// readers, a screenshot). Under `prefers-reduced-motion` the number just
// changes.
//
// Takes `locale`/`currencyCode` rather than an Intl.NumberFormat, since a
// formatter can't cross from a Server Component into a Client one.

import { useEffect, useMemo, useRef, useState } from "react";
import { createMoneyFormat } from "@/lib/currency";
import { COUNT_UP_MS, countUpValue } from "@/lib/chart-calc";

export function AnimatedNumber({
  value,
  locale,
  currencyCode,
  showPlus = false,
}: {
  value: number;
  locale: string;
  currencyCode?: string | null;
  /** Prefix a "+" on zero and positive values (Safe to spend, Remaining). */
  showPlus?: boolean;
}) {
  const numberFormat = useMemo(() => createMoneyFormat(locale, currencyCode), [locale, currencyCode]);
  // The in-between value while counting; null at rest, so the resting text
  // is always `value` itself and never a stale frame.
  const [frame, setFrame] = useState<number | null>(null);
  const shownRef = useRef(value);

  useEffect(() => {
    const from = shownRef.current;
    if (from === value) return;
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    if (reduceMotion) {
      shownRef.current = value;
      // Drops any frame left from a count the setting interrupted.
      raf = requestAnimationFrame(() => setFrame(null));
      return () => cancelAnimationFrame(raf);
    }
    let startedAt: number | null = null;
    const tick = (now: number) => {
      startedAt ??= now;
      const progress = (now - startedAt) / COUNT_UP_MS;
      const next = countUpValue(from, value, progress);
      shownRef.current = next;
      setFrame(progress >= 1 ? null : next);
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // A new value mid-count starts from where the digits are now
    // (shownRef), so the count turns round instead of jumping.
    return () => cancelAnimationFrame(raf);
  }, [value]);

  const shown = frame ?? value;
  return (
    <span className="tabular-nums">
      {showPlus && shown >= 0 ? "+" : ""}
      {numberFormat.format(shown)}
    </span>
  );
}
