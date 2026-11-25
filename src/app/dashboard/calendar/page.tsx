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
import { CalendarAgenda, type AgendaDayView } from "@/components/calendar/calendar-agenda";
import { todayDayNumber } from "@/app/dashboard/tasks/task-due";
import { loadUpcomingEvents, describeEventTime, upcomingDayHeading } from "@/app/dashboard/calendar/upcoming";
import { AGENDA_DAYS, dayNumberToDate, eventDateKey } from "@/lib/household-events";

// GAP-35: the household calendar. An agenda of the next AGENDA_DAYS days,
// grouped by day, repeats expanded (src/lib/household-events.ts). One query
// for the events and one for the "For" picker's members, shared by the
// header's "Add event" and the list through `cache()`, like the tasks page.
const getCalendarData = cache(async (householdId: string) => {
  const timeZone = await getTimeZone();
  const today = todayDayNumber(new Date(), timeZone);
  const [{ days, hasEvents }, householdMembers] = await Promise.all([
    loadUpcomingEvents(householdId, today, AGENDA_DAYS),
    prisma.householdMember.findMany({
      where: { householdId },
      include: { user: { select: { displayName: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const members: MemberOption[] = householdMembers.map((m) => ({ id: m.id, displayName: m.user.displayName }));
  return { today, days, hasEvents, members, defaultDate: eventDateKey(dayNumberToDate(today)) };
});

function addEventDialog(members: MemberOption[], defaultDate: string, dict: Dictionary["calendar"]) {
  return (
    <EventFormDialog
      mode="create"
      members={members}
      defaultDate={defaultDate}
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
async function AddEventButton({ householdId, dict }: { householdId: string; dict: Dictionary["calendar"] }) {
  const { members, defaultDate, hasEvents } = await getCalendarData(householdId);
  if (!hasEvents) return null;
  return <PrimaryAction>{addEventDialog(members, defaultDate, dict)}</PrimaryAction>;
}

async function AgendaSection({
  householdId,
  dict,
  locale,
}: {
  householdId: string;
  dict: Dictionary["calendar"];
  locale: Locale;
}) {
  const { today, days, hasEvents, members, defaultDate } = await getCalendarData(householdId);
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
      windowDays={AGENDA_DAYS}
      members={members}
      dict={dict}
      emptyAction={hasEvents ? undefined : addEventDialog(members, defaultDate, dict)}
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

export default async function CalendarPage() {
  const [{ household }, dict, locale] = await Promise.all([requireHousehold(), getDictionary(), getLocale()]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
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
          <AddEventButton householdId={household.id} dict={dict.calendar} />
        </Suspense>
      </div>
      <Suspense fallback={<AgendaSkeleton label={dict.common.loading} />}>
        <AgendaSection householdId={household.id} dict={dict.calendar} locale={locale} />
      </Suspense>
    </div>
  );
}
