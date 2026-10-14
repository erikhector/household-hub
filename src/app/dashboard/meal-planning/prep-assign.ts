// Shared plumbing for GAP-49's meal-prep actions (prep-actions.ts and the
// batch assign/discard actions). A plain server module rather than a
// "use server" file, so these helpers stay callable from inside another
// action's transaction without becoming client-callable endpoints of their
// own.
import type { Prisma } from "@/generated/prisma/client";

type MemberLookupClient = Pick<Prisma.TransactionClient, "householdMember">;

/**
 * The session user's HouseholdMember id in `householdId`, for a batch's
 * "cooked by" attribution. Null when the membership is gone (removed between
 * the session check and this read) — cookedByMemberId is nullable, so the
 * batch is still recorded, just unattributed.
 */
export async function findSessionMemberId(
  db: MemberLookupClient,
  householdId: string,
  userId: string,
): Promise<string | null> {
  const member = await db.householdMember.findUnique({
    where: { householdId_userId: { householdId, userId } },
    select: { id: true },
  });
  return member?.id ?? null;
}
