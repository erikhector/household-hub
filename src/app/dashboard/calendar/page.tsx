import { Suspense, cache } from "react";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getTimeZone } from "@/lib/get-time-zone";
import { getDictionary, getLocale, type Dictionary, type Locale } from "@/lib/i18n/get-dictionary";
import { Button } from "@/components/ui/button";
import { PageTitle } from "@/components/dashboard/page-title";
import { PrimaryAction } from "@/components/dashboard/primary-action";
import { EventFormDialog, type MemberOption } from "@/components/calendar/event-form-dialog";
import { CalendarMoreMenu } from "@/components/calendar/calendar-more-menu";
import { CalendarAgenda, type AgendaDayView } from "@/components/calendar/calendar-agenda";
import { todayDayNumber } from "@/app/dashboard/tasks/task-due";
import { loadUpcomingEvents, upcomingDayHeading } from "@/app/dashboard/calendar/upcoming";
import { agendaWindow, dayNumberToDate, describeEventTime, eventDateKey, type AgendaWindow } from "@/lib/household-events";

// GAP-35: the household calendar. An agenda of the next AGENDA_DAYS days,
// grouped by day, repeats expanded (src/lib/household-events.ts). One query
// for the events and one for the "For" picker's members, shared by the
// header's "Add event" and the list through `cache()`, like the tasks page.
// GAP-91: `?until=YYYY-MM-DD` ("Show later", or "Show" on the toast after a
// save past the window) runs the agenda further, up to AGENDA_MAX_DAYS.
const getCalendarData = cache(async (householdId: string, until: string | undefined) => {
  const timeZone = await getTimeZone();
  const today = todayDayNumber(new Date(), timeZone);
  const range = agendaWindow(today, until);
  const [{ days, hasEvents, hasLater }, householdMembers] = await Promise.all([
    loadUpcomingEvents(householdId, today, range.days),
    prisma.householdMember.findMany({
      where: { householdId },
      include: { user: { select: { displayName: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const members: MemberOption[] = householdMembers.map((m) => ({ id: m.id, displayName: m.user.displayName }));
  return { today, range, days, hasEvents, hasLater, members, defaultDate: eventDateKey(dayNumberToDate(today)) };
});

function addEventDialog(
  members: MemberOption[],
  defaultDate: string,
  range: AgendaWindow,
  dict: Dictionary["calendar"],
) {
  return (
    <EventFormDialog
      mode="create"
      members={members}
      defaultDate={defaultDate}
      agendaWindow={range}
      dict={dict}
      trigger={
        <Button className="gap-1.5">
          <Plus className="size-4" />
          <span>{dict.addEvent}</span>
        </Button>
      }
    />
  );
}

// With no events at all the empty state holds "Add event" (UX-50): one
// primary on screen, not two.
async function AddEventButton({
  householdId,
  until,
  dict,
}: {
  householdId: string;
  until: string | undefined;
  dict: Dictionary["calendar"];
}) {
  const { members, defaultDate, range, hasEvents } = await getCalendarData(householdId, until);
  if (!hasEvents) return null;
  return <PrimaryAction>{addEventDialog(members, defaultDate, range, dict)}</PrimaryAction>;
}

async function AgendaSection({
  householdId,
  until,
  dict,
  locale,
}: {
  householdId: string;
  until: string | undefined;
  dict: Dictionary["calendar"];
  locale: Locale;
}) {
  const { today, range, days, hasEvents, hasLater, members, defaultDate } = await getCalendarData(householdId, until);
  const memberName = new Map(members.map((m) => [m.id, m.displayName]));
  const repeatLabels = { WEEKLY: dict.repeatsWeekly, MONTHLY: dict.repeatsMonthly, YEARLY: dict.repeatsYearly };
  const view: AgendaDayView[] = days.map((day) => ({
    key: day.key,
    heading: upcomingDayHeading(day.date, today, locale, dict, "long"),
    rows: day.events.map((event) => ({
      event: {
        id: event.id,
        title: event.title,
        // The series' own first day: editing a repeat edits all of it.
        date: eventDateKey(event.seriesDate),
        startTime: event.startTime,
        endTime: event.endTime,
        notes: event.notes,
        forMemberId: event.forMemberId,
        recurrence: event.recurrence,
        reminder: event.reminder,
      },
      timeLabel: describeEventTime(event, locale, dict),
      repeatLabel: event.recurrence ? repeatLabels[event.recurrence] : null,
      forName: event.forMemberId ? (memberName.get(event.forMemberId) ?? null) : null,
    })),
  }));
  return (
    <CalendarAgenda
      days={view}
      hasEvents={hasEvents}
      hasLater={hasLater}
      agendaWindow={range}
      members={members}
      dict={dict}
      emptyAction={hasEvents ? undefined : addEventDialog(members, defaultDate, range, dict)}
    />
  );
}

function AgendaSkeleton({ label }: { label: string }) {
  return (
    <div className="list-bleed flex animate-pulse flex-col gap-2" role="status" aria-label={label}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-12 rounded-md border bg-muted/40" />
      ))}
    </div>
  );
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ until?: string | string[] }> }) {
  const [{ household }, dict, locale, params] = await Promise.all([
    requireHousehold(),
    getDictionary(),
    getLocale(),
    searchParams,
  ]);
  // A repeated `?until=` comes as an array; only a single value is read.
  const until = typeof params.until === "string" ? params.until : undefined;

  return (
    <div className="flex flex-col gap-6">
      {/* GAP-92: one row at every width: the title takes the room, and the
          ⋯ menu sits at its end, beside the title on a phone (where Add
          event floats in the thumb zone) and after Add event from `sm`. */}
      <div className="flex items-start gap-3 sm:items-center">
        <div className="min-w-0 flex-1">
          <PageTitle>{dict.calendar.title}</PageTitle>
          <p className="text-sm text-muted-foreground">{dict.calendar.subtitle}</p>
        </div>
        <Suspense
          fallback={
            <PrimaryAction>
              <div className="h-9 w-28 animate-pulse rounded-md bg-muted max-sm:h-12 max-sm:rounded-full" aria-hidden="true" />
            </PrimaryAction>
          }
        >
          <AddEventButton householdId={household.id} until={until} dict={dict.calendar} />
        </Suspense>
        <CalendarMoreMenu dict={dict.calendar} />
      </div>
      <Suspense fallback={<AgendaSkeleton label={dict.common.loading} />}>
        <AgendaSection householdId={household.id} until={until} dict={dict.calendar} locale={locale} />
      </Suspense>
    </div>
  );
}
