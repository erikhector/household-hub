"use server";

// GAP-35: the household calendar's events. Same household-scoping convention
// as tasks/actions.ts: requireHousehold() first, every query filtered by the
// session's household, and the one client-supplied member id (who the event
// is "for") checked to belong to it. Every member may add, edit or delete any
// event: the calendar is shared, like the notes board, and there is no
// per-member visibility. Nothing here notifies anyone: an event's reminder
// (GAP-88a) is only stored, and the daily notification run sends it
// (syncEventReminders, src/lib/event-reminders.ts).

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import type { ActionState } from "@/lib/actions/auth";
import { fail, toFriendlyError, v, zodFail } from "@/lib/actions/errors";
import {
  EVENT_NOTES_MAX_LENGTH,
  EVENT_TITLE_MAX_LENGTH,
  describeEventTime,
  eventDateKey,
  isEventTime,
  parseEventDate,
} from "@/lib/household-events";
import { getDictionary, getLocale, type Dictionary } from "@/lib/i18n/get-dictionary";
import { getTimeZone } from "@/lib/get-time-zone";
import { checkRateLimit } from "@/lib/rate-limit";
import { ICS_FILE_MAX_BYTES, parseIcsFile, type IcsFileError } from "@/lib/ics-import";

// Empty means "no time" (all day); anything else must be a 24-hour HH:MM,
// which is what <input type="time"> submits whatever the display locale.
const timeSchema = z
  .string()
  .trim()
  .refine((value) => value === "" || isEventTime(value), v("eventTimeInvalid"))
  .transform((value) => value || null);

const eventSchema = z
  .object({
    title: z.string().trim().min(1, v("titleRequired")).max(EVENT_TITLE_MAX_LENGTH, v("titleTooLong")),
    date: z
      .string()
      .trim()
      .refine((value) => parseEventDate(value) !== null, v("eventDateInvalid"))
      .transform((value) => parseEventDate(value)!),
    startTime: timeSchema,
    endTime: timeSchema,
    // Same handling as a task's notes: line breaks normalised, trimmed, cut
    // at the cap (the textarea's maxLength already stops typing there).
    notes: z
      .string()
      .transform((value) => value.replace(/\r\n?/g, "\n").trim().slice(0, EVENT_NOTES_MAX_LENGTH).trim() || null),
    forMemberId: z
      .string()
      .trim()
      .transform((value) => value || null),
    // "" is "doesn't repeat".
    recurrence: z.enum(["", "WEEKLY", "MONTHLY", "YEARLY"]).transform((value) => (value === "" ? null : value)),
    // GAP-88a: "" is "no reminder".
    reminder: z.enum(["", "MORNING_OF", "DAY_BEFORE"]).transform((value) => (value === "" ? null : value)),
  })
  .superRefine((data, ctx) => {
    // An end on its own has nothing to end; an end at or before the start
    // would be an event that never happens. "HH:MM" compares as text.
    if (data.endTime && !data.startTime) {
      ctx.addIssue({ code: "custom", path: ["endTime"], message: v("eventEndNeedsStart") });
    } else if (data.endTime && data.startTime && data.endTime <= data.startTime) {
      ctx.addIssue({ code: "custom", path: ["endTime"], message: v("eventEndBeforeStart") });
    }
  });

/**
 * Parses the Add/Edit form and checks the "for" member against the session
 * household. Returns the columns to write, or the translated error.
 */
async function parseEventForm(
  householdId: string,
  formData: FormData,
): Promise<{ error: string } | { data: z.infer<typeof eventSchema> }> {
  const field = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const parsed = eventSchema.safeParse({
    title: field("title"),
    date: field("date"),
    startTime: field("startTime"),
    endTime: field("endTime"),
    notes: field("notes"),
    forMemberId: field("forMemberId"),
    recurrence: field("recurrence"),
    reminder: field("reminder"),
  });
  if (!parsed.success) return await zodFail(parsed.error);

  if (parsed.data.forMemberId) {
    const member = await prisma.householdMember.findFirst({
      where: { id: parsed.data.forMemberId, householdId },
      select: { id: true },
    });
    if (!member) return await fail("memberNotFound");
  }
  return { data: parsed.data };
}

function revalidateCalendar() {
  revalidatePath("/dashboard/calendar");
  // Home's "Coming up" card lists the next few.
  revalidatePath("/dashboard");
}

export async function createEventAction(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const { household, userId } = await requireHousehold();

  const parsed = await parseEventForm(household.id, formData);
  if ("error" in parsed) return parsed;

  try {
    // Who added it comes from the session, never the form. `?? null` as in
    // createNoteAction: requireHousehold proved the membership, so a miss is
    // only a removal racing this request.
    const member = await prisma.householdMember.findFirst({
      where: { householdId: household.id, userId },
      select: { id: true },
    });
    await prisma.householdEvent.create({
      data: { householdId: household.id, createdByMemberId: member?.id ?? null, ...parsed.data },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidateCalendar();
  return {};
}

// Bound to the event's id by the edit sheet (`updateEventAction.bind(null, id)`).
export async function updateEventAction(
  eventId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = await parseEventForm(household.id, formData);
  if ("error" in parsed) return parsed;

  try {
    // updateMany scoped by household: another household's id updates nothing.
    const { count } = await prisma.householdEvent.updateMany({
      where: { id: eventId, householdId: household.id },
      data: parsed.data,
    });
    if (count === 0) return await fail("eventNotFound");
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidateCalendar();
  return {};
}

// A click action behind the row's Undo toast (UX-49): it only runs once the
// toast closes. deleteMany scoped by household makes a forged id from another
// household a silent no-op, like deleteNoteAction.
export async function deleteEventAction(eventId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  try {
    await prisma.householdEvent.deleteMany({ where: { id: eventId, householdId: household.id } });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidateCalendar();
  return {};
}

// GAP-92: "Import from file" (src/components/calendar/event-file-import-dialog.tsx).
// Two steps, both reading the same uploaded .ics file on the server, the
// pattern of the recipe file import (meal-planning/recipe-file-actions.ts):
//   1. previewEventFileAction parses it and returns the rows for review,
//      each flagged when an event with its title and date is already in the
//      household. Nothing is saved.
//   2. importEventFileAction gets the file again with the indexes left
//      ticked, parses it again (the parser is deterministic) and saves
//      those. The client never sends an event back, so what's saved is
//      always what the parser read from the file, through eventSchema, the
//      same validation as the Add event sheet.
// Rate-limited per household like the recipe import: each file is two
// requests, each parsing up to ICS_FILE_MAX_BYTES.
const EVENT_FILE_RATE_LIMIT = 30;
const EVENT_FILE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

type ImportFileDict = Dictionary["calendar"]["importFile"];
type EventData = z.infer<typeof eventSchema>;

export type EventFilePreviewRow = {
  index: number;
  title: string;
  /** "Fri, Mar 12, 2027", in the reader's language. */
  dateLabel: string;
  /** "All day", "14:30" or "14:30–15:15". */
  timeLabel: string;
  /** "Weekly" and so on; null for a one-off. */
  repeatLabel: string | null;
  /** An event with this title and date is already in the household, or earlier in the file; it won't be imported again. */
  exists: boolean;
};
export type PreviewEventFileState = ActionState & {
  preview?: { rows: EventFilePreviewRow[]; skipped: number };
};
export type ImportEventFileState = ActionState & { imported?: number };

function eventFileError(error: IcsFileError, dict: ImportFileDict): string {
  switch (error) {
    case "empty":
      return dict.errorEmpty;
    case "tooLarge":
      return dict.errorTooLarge;
    case "tooMany":
      return dict.errorTooMany;
    case "noEvents":
      return dict.errorNoEvents;
    case "unsupported":
    default:
      return dict.errorUnsupported;
  }
}

/**
 * The uploaded file's events that pass eventSchema, each with its index in
 * the file, and how many didn't (unreadable in the file, or refused by the
 * schema, e.g. no title). Or the message to show.
 */
async function readEventFile(
  formData: FormData,
  dict: ImportFileDict,
): Promise<{ rows: { index: number; data: EventData }[]; skipped: number } | { error: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: dict.errorNoFile };
  // The declared size first, so an oversized upload is never read into
  // memory; parseIcsFile checks the real byte length again.
  if (file.size > ICS_FILE_MAX_BYTES) return { error: dict.errorTooLarge };
  // HouseholdEvent times are floating, so a zoned time in the file is moved
  // into the importer's own zone, the one the calendar page uses for today.
  const parsed = parseIcsFile(new Uint8Array(await file.arrayBuffer()), await getTimeZone());
  if (!parsed.ok) return { error: eventFileError(parsed.error, dict) };

  const rows: { index: number; data: EventData }[] = [];
  let skipped = parsed.skipped;
  parsed.events.forEach((event, index) => {
    // An import sets no "for" member and no reminder: the file can't say
    // who in this household an event is for, and a reminder is a choice.
    const result = eventSchema.safeParse({ ...event, forMemberId: "", reminder: "" });
    if (result.success) rows.push({ index, data: result.data });
    else skipped += 1;
  });
  return { rows, skipped };
}

/** What makes two events the same for the duplicate check: the title (ignoring case and spacing) and the date. */
function duplicateKey(title: string, date: Date): string {
  return `${eventDateKey(date)}|${title.replace(/\s+/g, " ").trim().toLocaleLowerCase()}`;
}

/** The duplicate keys of the household's events on any of these dates. */
async function existingEventKeys(householdId: string, dates: Date[]): Promise<Set<string>> {
  if (dates.length === 0) return new Set();
  const events = await prisma.householdEvent.findMany({
    where: { householdId, date: { in: dates } },
    select: { title: true, date: true },
  });
  return new Set(events.map((event) => duplicateKey(event.title, event.date)));
}

async function eventFileLimited(householdId: string): Promise<boolean> {
  return !(await checkRateLimit(`event-file-import:${householdId}`, EVENT_FILE_RATE_LIMIT, EVENT_FILE_RATE_LIMIT_WINDOW_MS));
}

export async function previewEventFileAction(
  _prevState: PreviewEventFileState,
  formData: FormData,
): Promise<PreviewEventFileState> {
  const { household } = await requireHousehold();
  const [fullDict, locale] = await Promise.all([getDictionary(), getLocale()]);
  const dict = fullDict.calendar;
  if (await eventFileLimited(household.id)) return { error: dict.importFile.errorRateLimited };

  const parsed = await readEventFile(formData, dict.importFile);
  if ("error" in parsed) return { error: parsed.error };

  const existing = await existingEventKeys(
    household.id,
    parsed.rows.map((row) => row.data.date),
  );
  const repeatLabels = { WEEKLY: dict.repeatsWeekly, MONTHLY: dict.repeatsMonthly, YEARLY: dict.repeatsYearly };
  // Dates are UTC midnights, so they're read in UTC.
  const dateFormat = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  // A later copy of a row earlier in the file counts as there too, since
  // importEventFileAction skips it the same way: ticked, it would make
  // "Import 2 events" add one.
  return {
    preview: {
      skipped: parsed.skipped,
      rows: parsed.rows.map(({ index, data }) => {
        const key = duplicateKey(data.title, data.date);
        const exists = existing.has(key);
        existing.add(key);
        return {
          index,
          title: data.title,
          dateLabel: dateFormat.format(data.date),
          timeLabel: describeEventTime(data, locale, dict),
          repeatLabel: data.recurrence ? repeatLabels[data.recurrence] : null,
          exists,
        };
      }),
    },
  };
}

export async function importEventFileAction(
  _prevState: ImportEventFileState,
  formData: FormData,
): Promise<ImportEventFileState> {
  const { household, userId } = await requireHousehold();
  const dict = (await getDictionary()).calendar.importFile;
  if (await eventFileLimited(household.id)) return { error: dict.errorRateLimited };

  const parsed = await readEventFile(formData, dict);
  if ("error" in parsed) return { error: parsed.error };

  // Indexes into the file's events. Anything that isn't a valid row's is
  // ignored, and repeats collapse, so a hand-built POST can't pick a row
  // twice or one the schema refused.
  const picked = new Set(formData.getAll("index").map((value) => Number(value)));
  const selected = parsed.rows.filter((row) => picked.has(row.index));
  if (selected.length === 0) return { error: dict.errorNoneSelected };

  // An event whose title and date are already there is skipped, whether it
  // was in the household before or earlier in this same file, so importing
  // a file twice adds nothing the second time.
  const seen = await existingEventKeys(
    household.id,
    selected.map((row) => row.data.date),
  );
  const toCreate: EventData[] = [];
  for (const { data } of selected) {
    const key = duplicateKey(data.title, data.date);
    if (seen.has(key)) continue;
    seen.add(key);
    toCreate.push(data);
  }
  if (toCreate.length === 0) return { error: dict.errorNothingNew };

  try {
    // Who imported them comes from the session, never the form, as in
    // createEventAction.
    const member = await prisma.householdMember.findFirst({
      where: { householdId: household.id, userId },
      select: { id: true },
    });
    await prisma.householdEvent.createMany({
      data: toCreate.map((data) => ({
        ...data,
        householdId: household.id,
        createdByMemberId: member?.id ?? null,
        forMemberId: null,
        reminder: null,
      })),
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidateCalendar();
  return { imported: toCreate.length };
}
