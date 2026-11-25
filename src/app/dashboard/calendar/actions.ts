"use server";

// GAP-35: the household calendar's events. Same household-scoping convention
// as tasks/actions.ts: requireHousehold() first, every query filtered by the
// session's household, and the one client-supplied member id (who the event
// is "for") checked to belong to it. Every member may add, edit or delete any
// event: the calendar is shared, like the notes board, and there is no
// per-member visibility. Reminders are a later item (BACKLOG.md), so nothing
// here notifies anyone.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import type { ActionState } from "@/lib/actions/auth";
import { fail, toFriendlyError, v, zodFail } from "@/lib/actions/errors";
import {
  EVENT_NOTES_MAX_LENGTH,
  EVENT_TITLE_MAX_LENGTH,
  isEventTime,
  parseEventDate,
} from "@/lib/household-events";

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
