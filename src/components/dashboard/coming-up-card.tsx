import Link from "next/link";
import { CalendarClock, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loadUpcomingEvents, upcomingDayHeading } from "@/app/dashboard/calendar/upcoming";
import { describeEventTime, HOME_EVENT_DAYS, HOME_EVENT_LIMIT } from "@/lib/household-events";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

// GAP-35: Home's light touch of the household calendar, under Today: the
// next few events this week, each a link to the calendar. Nothing at all
// when there are none, so a household that doesn't use the calendar never
// sees an empty card on the page that answers "what needs me now?". Loads
// its own one query, rendered with the rest of Home rather than streamed in
// after it, so the cards below it never jump.
export async function ComingUpCard({
  householdId,
  today,
  locale,
  dict,
  calendarDict,
}: {
  householdId: string;
  /** Today as a local day number (task-due.ts), worked out by Home. */
  today: number;
  locale: Locale;
  dict: Dictionary["dashboard"]["comingUp"];
  calendarDict: Dictionary["calendar"];
}) {
  const { days } = await loadUpcomingEvents(householdId, today, HOME_EVENT_DAYS, { checkAny: false });
  const rows = days
    .flatMap((day) => day.events.map((event) => ({ day, event })))
    .slice(0, HOME_EVENT_LIMIT);
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="font-heading text-base font-semibold text-foreground">{dict.title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col gap-1" aria-label={dict.listAriaLabel}>
          {rows.map(({ day, event }) => (
            <li key={`${event.id}-${day.key}`}>
              <Link
                href="/dashboard/calendar"
                className="flex min-h-9 items-center gap-3 rounded-md px-1 text-sm hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none max-sm:min-h-11 pointer-coarse:min-h-11"
              >
                <CalendarClock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="line-clamp-2 font-medium break-words">{event.title}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {upcomingDayHeading(day.date, today, locale, calendarDict, "short")} ·{" "}
                    {describeEventTime(event, locale, calendarDict)}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
        <Link
          href="/dashboard/calendar"
          className="touch-target inline-flex items-center gap-1 self-start rounded-md text-sm font-medium text-primary hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {dict.openCalendar}
          <ChevronRight className="size-4 shrink-0" aria-hidden />
        </Link>
      </CardContent>
    </Card>
  );
}
