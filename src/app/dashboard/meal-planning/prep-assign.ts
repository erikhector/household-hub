// Shared plumbing for GAP-49's meal-prep actions (prep-actions.ts, and the
// planner actions that add, edit or delete an entry eating from a batch). A plain server module rather than a
// "use server" file, so these helpers stay callable from inside another
// action's transaction without becoming client-callable endpoints of their
// own.
import type { Prisma } from "@/generated/prisma/client";
import { getWeekStart, parseDateKey } from "@/app/dashboard/meal-planning/date-utils";
import type { MealType } from "@/app/dashboard/meal-planning/meal-types";
import { portionsAfterReturn, totalRequested } from "@/app/dashboard/meal-planning/prepared-batch-calc";

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

export type AssignBatch = { id: string; recipeId: string };
export type AssignSlot = { date: string; mealType: MealType; portions: number };
export type PrepAssignErrorKey = "prepNotEnoughPortions";

/**
 * Thrown inside the transaction so Prisma rolls back everything assignInTx
 * already wrote (the decrement, earlier slots' entries). The calling action
 * catches it after the transaction and turns `key` into `fail(key)`.
 */
export class PrepAssignError extends Error {
  constructor(readonly key: PrepAssignErrorKey) {
    super(key);
    this.name = "PrepAssignError";
  }
}

type AssignClient = Pick<Prisma.TransactionClient, "preparedBatch" | "mealPlan" | "mealPlanEntry">;

/**
 * Hands `slots` their portions of `batch`, inside the caller's transaction:
 * one guarded decrement for the total, then per slot either the link added
 * to the slot's existing plan for the same dish or a new linked entry beside
 * whatever else is planned there.
 * Returns the created or linked entry ids, in slot order. `batch` must
 * already be known to belong to `householdId`; the decrement re-checks it
 * anyway. Throws PrepAssignError, so the whole assignment lands or none of
 * it does.
 */
export async function assignInTx(
  tx: AssignClient,
  householdId: string,
  batch: AssignBatch,
  slots: AssignSlot[],
): Promise<string[]> {
  // Conditional rather than read-then-write, so two concurrent assigns can
  // never drive remainingPortions negative: the second one matches no row.
  const requested = totalRequested(slots);
  const decremented = await tx.preparedBatch.updateMany({
    where: { id: batch.id, householdId, remainingPortions: { gte: requested } },
    data: { remainingPortions: { decrement: requested } },
  });
  if (decremented.count === 0) throw new PrepAssignError("prepNotEnoughPortions");

  const entryIds: string[] = [];
  for (const slot of slots) {
    const date = parseDateKey(slot.date);
    const weekStartDate = getWeekStart(date);
    const plan = await tx.mealPlan.upsert({
      where: { householdId_weekStartDate: { householdId, weekStartDate } },
      update: {},
      create: { householdId, weekStartDate },
      select: { id: true },
    });

    const link = { portions: slot.portions, preparedBatchId: batch.id, preparedPortionsUsed: slot.portions };

    // The slot already plans this dish fresh ("lasagna on Thursday"): eat it
    // from the batch instead of planning it twice. Guarded like the
    // decrement, so an entry linked or cooked since this read isn't taken
    // over; the portion then gets an entry of its own below.
    const fresh = await tx.mealPlanEntry.findFirst({
      where: { mealPlanId: plan.id, date, mealType: slot.mealType, recipeId: batch.recipeId, preparedBatchId: null, consumedAt: null },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    if (fresh) {
      const linked = await tx.mealPlanEntry.updateMany({
        where: { id: fresh.id, preparedBatchId: null, consumedAt: null },
        data: link,
      });
      if (linked.count === 1) {
        entryIds.push(fresh.id);
        continue;
      }
    }

    // Anything else in the slot (another dish, a custom meal, another
    // batch's portion, a meal already eaten) stays as it is, and the
    // portion is added beside it: a household eating two things for dinner,
    // or a lunch box next to a fresh meal, plans both (owner feedback: the
    // "Taken" rule stopped prepped food going where it was really eaten).
    const created = await tx.mealPlanEntry.create({
      data: { mealPlanId: plan.id, date, mealType: slot.mealType, recipeId: batch.recipeId, ...link },
      select: { id: true },
    });
    entryIds.push(created.id);
  }
  return entryIds;
}

/**
 * A lost optimistic write in returnEntryPortionsInTx: an expected race, not
 * a bug. Thrown inside the transaction so it rolls back; the calling action
 * catches it and asks for a retry without reaching Sentry.
 */
export class BatchChangedError extends Error {
  constructor() {
    super("batch changed");
    this.name = "BatchChangedError";
  }
}

type ReturnClient = Pick<Prisma.TransactionClient, "preparedBatch">;
export type ReturnEntry = { id: string; preparedBatchId: string | null; preparedPortionsUsed: number };

/**
 * Gives `entry`'s portions back to its batch, inside the caller's
 * transaction. Only the batch side: the caller unlinks or deletes the entry
 * first, guarded on the values it read, so a double click returns the
 * portions once. A null batch (it went with its recipe, SetNull) or one no
 * longer in the household has nothing to give back to. Throws
 * BatchChangedError when the batch moved since it was read here.
 */
export async function returnEntryPortionsInTx(
  tx: ReturnClient,
  householdId: string,
  entry: ReturnEntry,
): Promise<void> {
  const { preparedBatchId, preparedPortionsUsed } = entry;
  if (preparedBatchId === null) return;

  const batch = await tx.preparedBatch.findFirst({
    where: { id: preparedBatchId, householdId },
    select: { remainingPortions: true, totalPortions: true },
  });
  if (!batch) return;
  // Optimistic: only writes if remainingPortions is still the value read
  // above. A concurrent assign that decremented in between would otherwise
  // be overwritten and its portions handed out twice. On a miss the throw
  // rolls back the caller's entry write too, and the household retries.
  const returned = await tx.preparedBatch.updateMany({
    where: { id: preparedBatchId, householdId, remainingPortions: batch.remainingPortions },
    data: {
      remainingPortions: portionsAfterReturn(batch.remainingPortions, batch.totalPortions, preparedPortionsUsed),
    },
  });
  if (returned.count === 0) throw new BatchChangedError();
}
