import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildIcalCalendar } from "@/lib/ical";
import {
  buildCalendarFeedEvents,
  calendarFeedWindow,
  isWellFormedCalendarFeedToken,
} from "@/lib/calendar-feed";
import { getDictionaryForLocale } from "@/lib/i18n/dictionaries";
import { defaultLocale, isLocale } from "@/lib/i18n/locales";
import { format } from "@/lib/i18n/format";

// GAP-3: the household's read-only iCalendar feed. Calendar apps fetch this
// on their own schedule with no cookies, so there's deliberately no session
// check: the token in the path is the whole credential, the same model as
// /share/shopping-list/[token]. Under /api, which src/proxy.ts's matcher
// excludes, so the login redirect never runs for it. See REQUIREMENTS.md's
// "Calendar feed" for the product decisions (opt-in, owner-managed, no
// amounts).
export const dynamic = "force-dynamic";

// A calendar client polls a few times an hour at most, so even a household
// with several people subscribed on several devices stays well under this.
// Keyed on the token rather than the caller's IP: Google Calendar fetches
// every subscribed feed from a shared pool of addresses, so an IP key would
// let one busy household throttle everyone else's. Its job is to stop a
// leaked link from being turned into a cheap way to hammer the database.
const CALENDAR_FEED_RATE_LIMIT = 120;
const CALENDAR_FEED_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

// Hard cap on meal entries per response so a pathological household can't
// make one request build an unbounded document. Far above the ~4 slots × 213
// days the window can realistically hold.
const MAX_MEAL_ENTRIES = 2000;

// no-store rather than a short max-age: turning the feed off or regenerating
// the link should take effect on the very next fetch, not after a cache
// somewhere in between expires.
const NO_STORE = "private, no-store";

function notFound(): Response {
  // One response for "malformed", "unknown" and "feed turned off", so the
  // endpoint says nothing about why a token didn't work.
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": NO_STORE },
  });
}

export async function GET(request: Request, ctx: RouteContext<"/api/calendar/[token]">) {
  const { token } = await ctx.params;
  if (!isWellFormedCalendarFeedToken(token)) return notFound();

  if (!(await checkRateLimit(`calendar-feed:${token}`, CALENDAR_FEED_RATE_LIMIT, CALENDAR_FEED_RATE_LIMIT_WINDOW_MS))) {
    return new Response("Too many requests", {
      status: 429,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": NO_STORE, "Retry-After": "3600" },
    });
  }

  // A lookup on the unique index: its timing depends on the index, not on
  // how much of the token matched, so it doesn't leak a usable signal the
  // way a hand-rolled string comparison could.
  const household = await prisma.household.findUnique({
    where: { calendarFeedToken: token },
    select: { id: true, name: true },
  });
  if (!household) return notFound();

  const lang = new URL(request.url).searchParams.get("lang") ?? undefined;
  const dict = getDictionaryForLocale(isLocale(lang) ? lang : defaultLocale);

  const now = new Date();
  const { from, to } = calendarFeedWindow(now);

  const [meals, bills] = await Promise.all([
    prisma.mealPlanEntry.findMany({
      where: { mealPlan: { householdId: household.id }, date: { gte: from, lte: to } },
      select: { id: true, date: true, mealType: true, freeformName: true, recipe: { select: { name: true } } },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      take: MAX_MEAL_ENTRIES,
    }),
    // Only expense templates are "bills"; income and savings items aren't
    // things anyone needs a due-date reminder for in a shared calendar.
    // Filtered to the ones with a concrete due day here so the query stays
    // small; buildCalendarFeedEvents applies the same rule on its own.
    prisma.recurringTemplate.findMany({
      where: {
        householdId: household.id,
        active: true,
        type: "EXPENSE",
        frequency: "MONTHLY",
        dayOfMonth: { not: null },
      },
      select: { id: true, name: true, frequency: true, dayOfMonth: true },
    }),
  ]);

  const feedDict = dict.household.calendarFeed.feed;
  const events = buildCalendarFeedEvents({
    meals: meals.map((m) => ({
      id: m.id,
      date: m.date,
      mealType: m.mealType,
      recipeName: m.recipe?.name ?? null,
      freeformName: m.freeformName,
    })),
    bills,
    from,
    to,
    strings: {
      mealSummary: feedDict.mealSummary,
      billSummary: feedDict.billSummary,
      mealTypes: {
        BREAKFAST: dict.mealPlanning.mealTypeBreakfast,
        LUNCH: dict.mealPlanning.mealTypeLunch,
        DINNER: dict.mealPlanning.mealTypeDinner,
        SNACK: dict.mealPlanning.mealTypeSnack,
      },
    },
  });

  const body = buildIcalCalendar({
    name: format(feedDict.calendarName, { household: household.name }),
    events,
    now,
    refreshInterval: "PT6H",
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="squirrel.ics"',
      "Cache-Control": NO_STORE,
      // The URL is a secret; keep it out of search indexes if it ever gets
      // posted somewhere public.
      "X-Robots-Tag": "noindex",
    },
  });
}
