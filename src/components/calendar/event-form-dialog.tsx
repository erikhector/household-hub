"use client";

// GAP-35: the Add/Edit sheet for a household calendar event. Same shape as
// TaskFormDialog (one component, `mode`, one <Dialog> around one <form>,
// closes on success): a name, the day (today by default, M4), optional start
// and end times (none is all day), a repeat, a reminder (GAP-88a), who it's
// for and a few lines of notes. Both modes are form actions; edit binds the
// event's id. GAP-91: a save dated after the agenda's last day wouldn't show
// on the page, so a toast names the day and offers "Show".

import { useActionState, useState, type FormEvent, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldError, fieldErrorId } from "@/components/auth/field-error";
import { useRequiredFields } from "@/components/shared/use-required-fields";
import { guardFormAction } from "@/components/shared/guard-form-action";
import { createEventAction, updateEventAction } from "@/app/dashboard/calendar/actions";
import type { ActionState } from "@/lib/actions/auth";
import {
  EVENT_NOTES_MAX_LENGTH,
  EVENT_TITLE_MAX_LENGTH,
  eventDayLabel,
  type AgendaWindow,
  type EventRecurrence,
  type EventReminder,
} from "@/lib/household-events";
import { format } from "@/lib/i18n/format";
import { getDocumentLocale } from "@/lib/i18n/client-locale";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export type CalendarDict = Dictionary["calendar"];
export type MemberOption = { id: string; displayName: string };

export type EditableEvent = {
  id: string;
  title: string;
  /** YYYY-MM-DD. */
  date: string;
  startTime: string | null;
  endTime: string | null;
  notes: string | null;
  forMemberId: string | null;
  recurrence: EventRecurrence | null;
  reminder: EventReminder | null;
};

// Base UI's Select doesn't take "" as an item value, so "doesn't repeat",
// "no reminder" and "everyone" need sentinels; they're submitted as ""
// through hidden inputs.
const NO_REPEAT = "__none__";
const NO_REMINDER = "__no_reminder__";
const EVERYONE = "__everyone__";
// The counters show this close to the cap (UX-107), like the task sheet's.
const TITLE_COUNTER_FROM = 100;
const NOTES_COUNTER_FROM = 450;

const initialState: ActionState = {};

export function EventFormDialog({
  mode,
  event,
  defaultDate,
  agendaWindow,
  members,
  dict,
  trigger,
  onDelete,
}: {
  mode: "create" | "edit";
  /** Edit mode only. */
  event?: EditableEvent;
  /** Create mode: the date field's starting value, today in the user's zone. */
  defaultDate?: string;
  /** The agenda the page shows, to tell when a save lands past it. */
  agendaWindow: AgendaWindow;
  members: MemberOption[];
  dict: CalendarDict;
  trigger: ReactElement;
  /** Edit mode: adds Delete to the sheet, handed to the row's own delete
   *  button so the Undo toast is the same one the row shows. */
  onDelete?: () => void;
}) {
  const initial = () => ({
    title: event?.title ?? "",
    date: event?.date ?? defaultDate ?? "",
    startTime: event?.startTime ?? "",
    endTime: event?.endTime ?? "",
    notes: event?.notes ?? "",
    forMemberId: event?.forMemberId ?? EVERYONE,
    recurrence: event?.recurrence ?? NO_REPEAT,
    reminder: event?.reminder ?? NO_REMINDER,
  });
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(initial);
  const set = (field: keyof ReturnType<typeof initial>, value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  const req = useRequiredFields();
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    req.check(e, [
      { name: "title", id: "event-title", message: dict.titleRequired },
      { name: "date", id: "event-date", message: dict.dateRequired },
    ]);
  }

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    req.clear();
    if (next) setValues(initial());
  };

  const router = useRouter();
  // Read from what was submitted, not `values`: the form is the source of
  // truth for this save. `YYYY-MM-DD` keys compare as strings.
  function announceIfPastAgenda(formData: FormData) {
    const date = String(formData.get("date") ?? "");
    if (date <= agendaWindow.end) return;
    const message = format(dict.savedLaterToast, {
      name: String(formData.get("title") ?? "").trim(),
      date: eventDayLabel(date, getDocumentLocale(), new Date().getFullYear()),
    });
    // Past the furthest the page opens there's nothing to show; the
    // calendar feed still has it.
    toast.success(
      message,
      date <= agendaWindow.maxEnd
        ? {
            action: {
              label: dict.showSaved,
              onClick: () => router.push(`/dashboard/calendar?until=${date}`, { scroll: false }),
            },
          }
        : undefined,
    );
  }

  const serverAction =
    mode === "edit" && event ? updateEventAction.bind(null, event.id) : createEventAction;
  const [state, formAction, pending] = useActionState(
    guardFormAction(async (prevState: ActionState, formData: FormData): Promise<ActionState> => {
      const result = await serverAction(prevState, formData);
      if (result.error) return result;
      handleOpenChange(false);
      announceIfPastAgenda(formData);
      return {};
    }, dict.saveFailedToast),
    initialState,
  );

  const showTitleCounter = values.title.length >= TITLE_COUNTER_FROM;
  const showNotesCounter = values.notes.length >= NOTES_COUNTER_FROM;
  const repeatLabels: Record<string, string> = {
    [NO_REPEAT]: dict.repeatNone,
    WEEKLY: dict.repeatWeekly,
    MONTHLY: dict.repeatMonthly,
    YEARLY: dict.repeatYearly,
  };
  const reminderLabels: Record<string, string> = {
    [NO_REMINDER]: dict.reminderNone,
    MORNING_OF: dict.reminderMorningOf,
    DAY_BEFORE: dict.reminderDayBefore,
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? dict.addEventDialogTitle : format(dict.editEventDialogTitle, { name: event?.title ?? "" })}
          </DialogTitle>
        </DialogHeader>
        <form action={formAction} onSubmit={onSubmit} onInput={req.onInput} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="event-title">{dict.titleLabel}</Label>
            <Input
              id="event-title"
              name="title"
              autoComplete="off"
              enterKeyHint="next"
              value={values.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder={dict.titlePlaceholder}
              maxLength={EVENT_TITLE_MAX_LENGTH}
              aria-invalid={req.messageFor("title") ? true : undefined}
              aria-describedby={
                [req.messageFor("title") && fieldErrorId("event-title"), showTitleCounter && "event-title-counter"]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
            />
            <FieldError fieldId="event-title">{req.messageFor("title")}</FieldError>
            {showTitleCounter && (
              <p
                id="event-title-counter"
                role="status"
                className={`text-xs ${values.title.length >= EVENT_TITLE_MAX_LENGTH ? "text-destructive" : "text-muted-foreground"}`}
              >
                {format(dict.titleCounter, { count: values.title.length, max: EVENT_TITLE_MAX_LENGTH })}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="event-date">{dict.dateLabel}</Label>
            <Input
              id="event-date"
              type="date"
              name="date"
              value={values.date}
              onChange={(e) => set("date", e.target.value)}
              className="max-sm:min-h-11"
              aria-invalid={req.messageFor("date") ? true : undefined}
              aria-describedby={req.messageFor("date") ? fieldErrorId("event-date") : undefined}
            />
            <FieldError fieldId="event-date">{req.messageFor("date")}</FieldError>
          </div>
          {/* Two short time fields fit side by side at 412 px (M1 stacks
              comboboxes and three-up rows, not two times). */}
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor="event-start">{dict.startTimeLabel}</Label>
                <Input
                  id="event-start"
                  type="time"
                  name="startTime"
                  value={values.startTime}
                  onChange={(e) => set("startTime", e.target.value)}
                  className="max-sm:min-h-11"
                  aria-describedby="event-time-hint"
                />
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor="event-end">{dict.endTimeLabel}</Label>
                <Input
                  id="event-end"
                  type="time"
                  name="endTime"
                  value={values.endTime}
                  onChange={(e) => set("endTime", e.target.value)}
                  className="max-sm:min-h-11"
                  aria-describedby="event-time-hint"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p id="event-time-hint" className="text-xs text-muted-foreground">
                {dict.timeHint}
              </p>
              {/* A native time field is fiddly to empty on a phone, so one tap
                  takes both back to all day. */}
              {(values.startTime !== "" || values.endTime !== "") && (
                <Button
                  type="button"
                  variant="ghost"
                  className="shrink-0 max-sm:min-h-11 pointer-coarse:min-h-11"
                  onClick={() => setValues((current) => ({ ...current, startTime: "", endTime: "" }))}
                >
                  {dict.makeAllDay}
                </Button>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="event-recurrence">{dict.repeatLabel}</Label>
            <Select value={values.recurrence} onValueChange={(v) => set("recurrence", String(v))}>
              <input type="hidden" name="recurrence" value={values.recurrence === NO_REPEAT ? "" : values.recurrence} />
              <SelectTrigger id="event-recurrence">
                <SelectValue>{(v: string) => repeatLabels[v] ?? dict.repeatNone}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(repeatLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="event-reminder">{dict.reminderLabel}</Label>
            <Select value={values.reminder} onValueChange={(v) => set("reminder", String(v))}>
              <input type="hidden" name="reminder" value={values.reminder === NO_REMINDER ? "" : values.reminder} />
              <SelectTrigger id="event-reminder" aria-describedby="event-reminder-hint">
                <SelectValue>{(v: string) => reminderLabels[v] ?? dict.reminderNone}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(reminderLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Who gets it isn't chosen here: each member opts in on their
                Profile, so say where, or a reminder set and never felt
                looks broken. */}
            <p id="event-reminder-hint" className="text-xs text-muted-foreground">
              {dict.reminderHint}
            </p>
          </div>
          {/* Who it's for only means something with more than one person. */}
          {members.length > 1 && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="event-for">{dict.forLabel}</Label>
              <Select value={values.forMemberId} onValueChange={(v) => set("forMemberId", String(v))}>
                <input type="hidden" name="forMemberId" value={values.forMemberId === EVERYONE ? "" : values.forMemberId} />
                <SelectTrigger id="event-for">
                  <SelectValue>
                    {(v: string) => members.find((m) => m.id === v)?.displayName ?? dict.forEveryone}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EVERYONE}>{dict.forEveryone}</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="event-notes">{dict.notesLabel}</Label>
            <Textarea
              id="event-notes"
              name="notes"
              autoComplete="off"
              enterKeyHint="done"
              rows={3}
              value={values.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder={dict.notesPlaceholder}
              maxLength={EVENT_NOTES_MAX_LENGTH}
              aria-describedby={showNotesCounter ? "event-notes-counter" : undefined}
            />
            {showNotesCounter && (
              <p
                id="event-notes-counter"
                role="status"
                className={`text-xs ${values.notes.length >= EVENT_NOTES_MAX_LENGTH ? "text-destructive" : "text-muted-foreground"}`}
              >
                {format(dict.titleCounter, { count: values.notes.length, max: EVENT_NOTES_MAX_LENGTH })}
              </p>
            )}
          </div>
          {state.error && (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          )}
          <DialogFooter>
            {/* As on the task sheet: Delete last in the stacked footer, away
                from Save and quiet, so Save stays the one primary. */}
            {mode === "edit" && onDelete && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive sm:mr-auto"
                disabled={pending}
                onClick={() => {
                  handleOpenChange(false);
                  requestAnimationFrame(onDelete);
                }}
              >
                {dict.delete}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
              {dict.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? (mode === "create" ? dict.adding : dict.saving) : mode === "create" ? dict.add : dict.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
