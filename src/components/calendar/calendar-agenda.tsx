"use client";

// GAP-35: the household calendar as an agenda: one group per day that has
// anything on it, repeats already expanded on the server
// (src/app/dashboard/calendar/page.tsx, buildAgenda). A row is the task
// list's row: the title opens the edit sheet (which has Delete), a left
// swipe shows Edit and Delete, and from `sm` up both are icons too. Deleting
// takes the event out at tap time, every day it falls on, with an Undo toast
// (UX-49); the server hears of it when the toast closes. GAP-91: "Show
// later" under the list runs the agenda AGENDA_DAYS further (`?until=`)
// while anything falls after it.

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Repeat, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SwipeRow } from "@/components/shared/swipe-row";
import { startUndoableDelete } from "@/components/shared/start-undoable-delete";
import { settleOptimisticAction } from "@/components/shared/settle-optimistic-action";
import { MascotEmptyState } from "@/components/brand/mascot-empty-state";
import {
  EventFormDialog,
  type CalendarDict,
  type EditableEvent,
  type MemberOption,
} from "@/components/calendar/event-form-dialog";
import { deleteEventAction } from "@/app/dashboard/calendar/actions";
import { format } from "@/lib/i18n/format";
import type { AgendaWindow } from "@/lib/household-events";

type AgendaRow = {
  event: EditableEvent;
  /** "All day", "14:30" or "14:30–15:15", already formatted. */
  timeLabel: string;
  /** "Weekly" etc., or null for a one-off. */
  repeatLabel: string | null;
  /** The member it's for, or null for everyone. */
  forName: string | null;
};

export type AgendaDayView = {
  /** YYYY-MM-DD. */
  key: string;
  /** "Today, Thursday 3 December". */
  heading: string;
  rows: AgendaRow[];
};

export function CalendarAgenda({
  days,
  hasEvents,
  hasLater,
  agendaWindow,
  members,
  dict,
  emptyAction,
}: {
  days: AgendaDayView[];
  /** Whether the household has any event at all, inside the window or not. */
  hasEvents: boolean;
  /** Whether any event falls after the window. */
  hasLater: boolean;
  agendaWindow: AgendaWindow;
  members: MemberOption[];
  dict: CalendarDict;
  /** "Add event" for the empty state, which then holds the page's primary. */
  emptyAction?: ReactNode;
}) {
  // Events deleted on this visit, every occurrence of each.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const setEventHidden = (id: string, value: boolean) =>
    setHidden((current) => {
      const next = new Set(current);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });

  const deleteEvent = (event: EditableEvent) => {
    setEventHidden(event.id, true);
    startUndoableDelete({
      run: async () => {
        const result = await settleOptimisticAction(() => deleteEventAction(event.id), dict.saveFailedToast);
        return result !== null;
      },
      restore: () => setEventHidden(event.id, false),
      message: format(dict.deletedToast, { name: event.title }),
      undoLabel: dict.undo,
    });
  };

  const shownDays = days
    .map((day) => ({ ...day, rows: day.rows.filter((row) => !hidden.has(row.event.id)) }))
    .filter((day) => day.rows.length > 0);

  if (!hasEvents) {
    return (
      <MascotEmptyState alt={dict.mascotAlt} action={emptyAction}>
        <p className="text-sm text-muted-foreground">{dict.emptyState}</p>
      </MascotEmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {shownDays.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          {format(dict.emptyWindow, { days: agendaWindow.days })}
        </p>
      ) : (
        <div className="flex flex-col gap-6" role="list" aria-label={dict.agendaAriaLabel}>
          {shownDays.map((day) => (
            <section key={day.key} role="listitem" aria-labelledby={`day-${day.key}`} className="flex flex-col gap-2">
              <h2 id={`day-${day.key}`} className="text-item-title font-semibold">
                {day.heading}
              </h2>
              <ul className="flex flex-col gap-2">
                {day.rows.map((row) => (
                  <li key={`${row.event.id}-${day.key}`}>
                    <EventRow
                      row={row}
                      members={members}
                      agendaWindow={agendaWindow}
                      dict={dict}
                      onDelete={deleteEvent}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {/* Under the list, or under "Nothing in the next 60 days", and only
          while something lies past the window and under the cap. */}
      <div className="flex flex-col items-start gap-2">
        <p className="text-xs text-muted-foreground">{format(dict.windowNote, { days: agendaWindow.days })}</p>
        {hasLater && agendaWindow.laterUntil && <ShowLaterButton until={agendaWindow.laterUntil} label={dict.showLater} />}
      </div>
    </div>
  );
}

function ShowLaterButton({ until, label }: { until: string; label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      className="gap-1.5 max-sm:min-h-11 pointer-coarse:min-h-11"
      disabled={pending}
      aria-busy={pending || undefined}
      // scroll: false keeps the reader where they were; the new days land
      // below the ones they've seen.
      onClick={() => startTransition(() => router.push(`/dashboard/calendar?until=${until}`, { scroll: false }))}
    >
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {label}
    </Button>
  );
}

function EventRow({
  row,
  members,
  agendaWindow,
  dict,
  onDelete,
}: {
  row: AgendaRow;
  members: MemberOption[];
  agendaWindow: AgendaWindow;
  dict: CalendarDict;
  onDelete: (event: EditableEvent) => void;
}) {
  const { event } = row;
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const hasDetails = row.forName !== null || row.repeatLabel !== null || event.notes !== null;

  return (
    <SwipeRow
      className="list-bleed rounded-md"
      editLabel={dict.edit}
      deleteLabel={dict.delete}
      onDelete={() => onDelete(event)}
    >
      <div className="flex items-center gap-3 rounded-md border bg-card px-3 py-1 sm:py-2">
        {/* The time leads, like a calendar app's agenda: the eye runs down
            the times to find a gap. Fixed width so the titles line up. */}
        <span className="w-20 shrink-0 text-sm text-muted-foreground tabular-nums sm:w-24">{row.timeLabel}</span>
        <div className="flex min-w-0 flex-1 flex-col">
          {/* The title opens the edit sheet by clicking the row's edit
              button, the same hand-off the swipe uses (tasks, UX-101). */}
          <button
            type="button"
            className="min-w-0 cursor-pointer rounded-sm text-left line-clamp-2 break-words focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:line-clamp-1 max-sm:flex max-sm:min-h-11 max-sm:items-center pointer-coarse:min-h-11"
            title={event.title}
            onClick={(e) =>
              e.currentTarget.closest("[data-swipe-row]")?.querySelector<HTMLElement>("[data-swipe-edit]")?.click()
            }
          >
            {event.title}
          </button>
          {hasDetails && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pb-1 text-xs text-muted-foreground sm:pb-0">
              {row.forName && <span>{format(dict.forName, { name: row.forName })}</span>}
              {row.repeatLabel && (
                <Badge variant="outline" className="shrink-0 gap-1 text-muted-foreground">
                  <Repeat className="size-3" aria-hidden />
                  {row.repeatLabel}
                </Badge>
              )}
              {/* Plain text, one line; the full notes are in the sheet. */}
              {event.notes && (
                <span className="min-w-0 basis-full truncate" title={event.notes}>
                  {event.notes}
                </span>
              )}
            </div>
          )}
        </div>
        {/* Edit and Delete as icons from sm up. On a phone the left swipe
            and the sheet (a tap on the title) have them, so the row carries
            neither; they stay mounted, hidden, for the swipe and the sheet
            to click. */}
        <div className="flex shrink-0 items-center gap-2">
          <EventFormDialog
            mode="edit"
            event={event}
            members={members}
            agendaWindow={agendaWindow}
            dict={dict}
            onDelete={() => deleteButtonRef.current?.click()}
            trigger={
              <Button
                variant="ghost"
                size="icon"
                data-swipe-edit
                className="size-7 shrink-0 text-muted-foreground hover:text-foreground max-sm:hidden"
                aria-label={format(dict.editAriaLabel, { title: event.title })}
              >
                <Pencil className="size-3.5" />
              </Button>
            }
          />
          <Button
            ref={deleteButtonRef}
            variant="ghost"
            size="icon"
            data-row-delete
            className="size-7 shrink-0 text-muted-foreground hover:text-destructive max-sm:hidden"
            aria-label={format(dict.deleteAriaLabel, { title: event.title })}
            onClick={() => onDelete(event)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
    </SwipeRow>
  );
}

