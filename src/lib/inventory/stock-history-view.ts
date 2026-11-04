import { format } from "@/lib/i18n/format";
import type { StockEventReason } from "@/lib/inventory/stock-history";

// GAP-66: how the item page words one history row. Pure, so the wording and
// the "N days ago" maths are unit-tested without rendering anything.
export type StockHistoryDict = {
  historySomeone: string;
  historyUsed: string;
  historyRestocked: string;
  historyAdjusted: string;
  historyCooked: string;
  historyTrip: string;
  historyLine: string;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// "now" / "5 minutes ago" / "2 days ago" in the viewer's locale, via Intl
// so Swedish gets "för 2 dagar sedan" for free. Beyond a month it stops
// being useful as a relative figure, so it falls back to the date.
export function relativeAge(then: Date, now: Date, locale: string): string {
  const ms = Math.max(0, now.getTime() - then.getTime());
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  if (ms < MINUTE) return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(0, "second");
  if (ms < HOUR) return rtf.format(-Math.floor(ms / MINUTE), "minute");
  if (ms < DAY) return rtf.format(-Math.floor(ms / HOUR), "hour");
  if (ms < 30 * DAY) return rtf.format(-Math.floor(ms / DAY), "day");
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(then);
}

export function describeStockEvent(
  event: { reason: string; delta: number; userName: string | null; createdAt: Date },
  options: { unit: string; now: Date; locale: string; dict: StockHistoryDict },
): string {
  const { dict } = options;
  const size = String(Math.round(Math.abs(event.delta) * 100) / 100);
  // "adjusted" is the only reason that can go either way, so it alone shows
  // a sign; the others already say which way in the verb.
  const signed = event.delta < 0 ? `−${size}` : `+${size}`;
  const amount = `${event.reason === "adjusted" ? signed : size} ${options.unit}`;
  const templates: Record<StockEventReason, string> = {
    used: dict.historyUsed,
    restocked: dict.historyRestocked,
    adjusted: dict.historyAdjusted,
    cooked: dict.historyCooked,
    trip: dict.historyTrip,
  };
  const template = templates[event.reason as StockEventReason] ?? dict.historyAdjusted;
  return format(dict.historyLine, {
    what: format(template, { name: event.userName ?? dict.historySomeone, amount }),
    when: relativeAge(event.createdAt, options.now, options.locale),
  });
}
