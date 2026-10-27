// The read-only household calendar feed (GAP-3): everything about it that
// isn't I/O. The route (src/app/api/calendar/[token]/route.ts) loads rows
// and hands them to buildCalendarFeedEvents; the Household page and its
// actions use the token helpers. See REQUIREMENTS.md's "Calendar feed".
import { randomBytes } from "crypto";
import type { IcalAllDayEvent } from "@/lib/ical";
import { expandMonthlyDueDates, type TemplateFrequency } from "@/lib/recurring-template-calc";
import { format } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locales";

// 32 random bytes = 256 bits, far beyond guessable even with no rate limit at
// all. Other tokens in this app are randomUUID() (122 bits), which is fine
// for links that expire or get used once; this one never expires on its own
// and sits in calendar apps' settings indefinitely, so it gets the larger
// size. base64url because it goes straight into a URL path.
const CALENDAR_FEED_TOKEN_BYTES = 32;

export function generateCalendarFeedToken(): string {
  return randomBytes(CALENDAR_FEED_TOKEN_BYTES).toString("base64url");
}

// 32 bytes of base64url without padding is always exactly 43 characters.
const CALENDAR_FEED_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Cheap shape check the route runs before touching the database or the rate
 * limiter, so a request with an obviously bogus token costs nothing and
 * can't create rate-limit buckets for arbitrary strings.
 */
export function isWellFormedCalendarFeedToken(token: string): boolean {
  return CALENDAR_FEED_TOKEN_PATTERN.test(token);
}

/**
 * Path of the feed, relative to the app's origin. The viewer's locale goes
 * in the query string because the feed has no session or cookie to read a
 * language preference from — whoever copies the link gets event titles in
 * the language they were using when they copied it.
 */
export function calendarFeedPath(token: string, locale: Locale): string {
  return `/api/calendar/${token}?lang=${locale}`;
}

// A month back so last week's dinners are still there to look up, and about
// six months ahead, which covers every meal anyone realistically plans and
// two quarters of bills. Bounded both ways so the feed's size doesn't grow
// with the household's history.
const CALENDAR_FEED_PAST_DAYS = 30;
const CALENDAR_FEED_FUTURE_DAYS = 183;

/** The [from, to] window of UTC days the feed covers, both inclusive. */
export function calendarFeedWindow(now: Date): { from: Date; to: Date } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  return {
    from: new Date(Date.UTC(y, m, d - CALENDAR_FEED_PAST_DAYS)),
    to: new Date(Date.UTC(y, m, d + CALENDAR_FEED_FUTURE_DAYS)),
  };
}

export type FeedMealType = "BREAKFAST" | "LUNCH" | "DINNER" | "SNACK";

export type FeedMealEntry = {
  id: string;
  date: Date;
  mealType: FeedMealType;
  recipeName: string | null;
  freeformName: string | null;
};

export type FeedBill = {
  id: string;
  name: string;
  frequency: TemplateFrequency;
  dayOfMonth: number | null;
};

export type CalendarFeedStrings = {
  mealSummary: string;
  billSummary: string;
  mealTypes: Record<FeedMealType, string>;
};

// Breakfast → snack, so a day's meals list in eating order wherever a client
// keeps the feed's own order for same-day all-day events.
const MEAL_TYPE_ORDER: Record<FeedMealType, number> = { BREAKFAST: 0, LUNCH: 1, DINNER: 2, SNACK: 3 };

// The right-hand side just has to make the UID unique to this app; entry and
// template ids are cuids, unique on their own.
const UID_DOMAIN = "squirrel-calendar-feed";

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Turns meal-plan entries and recurring bills into the feed's events.
 *
 * Only what a calendar needs: a meal's slot and name, and a bill's name. No
 * amounts, recipes, notes or member names, since the link works without a
 * login and gets pasted into third-party calendar services.
 *
 * Bills only appear when they have a concrete due day, which today means a
 * MONTHLY template with `dayOfMonth` set. WEEKLY and YEARLY templates have no
 * due day in the schema (dayOfMonth is ignored for them), and inventing one
 * from createdAt would put a bill on a day nobody chose.
 *
 * Callers pass only active EXPENSE templates and meals already inside
 * [from, to]; meals are filtered again here so the window is enforced in one
 * testable place.
 */
export function buildCalendarFeedEvents({
  meals,
  bills,
  from,
  to,
  strings,
}: {
  meals: FeedMealEntry[];
  bills: FeedBill[];
  from: Date;
  to: Date;
  strings: CalendarFeedStrings;
}): IcalAllDayEvent[] {
  const fromKey = dayKey(from);
  const toKey = dayKey(to);

  const mealEvents = meals
    .filter((meal) => {
      const key = dayKey(meal.date);
      return key >= fromKey && key <= toKey;
    })
    .map((meal) => {
      const slot = strings.mealTypes[meal.mealType];
      // A recipe that was deleted leaves recipeId null (onDelete: SetNull)
      // with no freeform name to fall back on; the slot alone still tells
      // the reader a meal was planned.
      const name = (meal.recipeName ?? meal.freeformName ?? "").trim();
      return {
        sortKey: `${dayKey(meal.date)}|0|${MEAL_TYPE_ORDER[meal.mealType]}|${meal.id}`,
        event: {
          uid: `meal-${meal.id}@${UID_DOMAIN}`,
          date: meal.date,
          summary: name ? format(strings.mealSummary, { meal: slot, name }) : slot,
        },
      };
    });

  const billEvents = bills.flatMap((bill) => {
    if (bill.frequency !== "MONTHLY" || bill.dayOfMonth == null) return [];
    return expandMonthlyDueDates(bill.dayOfMonth, from, to).map((date) => {
      // One UID per template per due day: stable across fetches, and a
      // change to dayOfMonth reads to the calendar as old events removed and
      // new ones added, which is exactly what happened.
      const key = dayKey(date);
      return {
        sortKey: `${key}|1|${bill.name}|${bill.id}`,
        event: {
          uid: `bill-${bill.id}-${key.replace(/-/g, "")}@${UID_DOMAIN}`,
          date,
          summary: format(strings.billSummary, { name: bill.name }),
        },
      };
    });
  });

  return [...mealEvents, ...billEvents]
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
    .map((entry) => entry.event);
}
