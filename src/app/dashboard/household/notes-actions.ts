"use server";

// GAP-16: the shared household notes board on the Household page. Add +
// delete only (no edit, pinning or rich text in v1). Same household-scoping
// convention as src/app/dashboard/tasks/actions.ts: requireHousehold() first,
// every query/mutation filtered by householdId from the session, never a
// household id from the client. Deliberately not a notification trigger — a
// bell badge must mean something's wrong, and a note is just something you
// check when you open the page.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import type { ActionState } from "@/lib/actions/auth";
import { toFriendlyError } from "@/lib/actions/errors";
import { NOTE_BODY_MAX_LENGTH } from "@/lib/household-notes";

const createNoteSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Note can't be empty")
    .max(NOTE_BODY_MAX_LENGTH, `Note must be ${NOTE_BODY_MAX_LENGTH} characters or fewer`),
});

export async function createNoteAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household, userId } = await requireHousehold();

  const parsed = createNoteSchema.safeParse({ body: formData.get("body") ?? "" });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  try {
    // The author is resolved from the session, not the form, so a note can
    // never be attributed to someone else. `?? null` rather than an error:
    // requireHousehold already proved the membership exists, so a miss here
    // is only a removal racing this request, and an unattributed note (shown
    // as "former member") beats losing what the user just typed.
    const member = await prisma.householdMember.findFirst({
      where: { householdId: household.id, userId },
      select: { id: true },
    });
    await prisma.householdNote.create({
      data: {
        householdId: household.id,
        authorMemberId: member?.id ?? null,
        body: parsed.data.body,
      },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/household");
  return {};
}

// Any member may delete any note, not just its author or the owner — same
// as deleteShoppingListAction. The board is shared household scratch space
// (a note is often cleared by whoever dealt with it), and gating it would
// strand notes written by members who've since left. deleteMany scoped by
// householdId makes a forged id from another household a silent no-op.
export async function deleteNoteAction(noteId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  try {
    await prisma.householdNote.deleteMany({
      where: { id: noteId, householdId: household.id },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/household");
  return {};
}
