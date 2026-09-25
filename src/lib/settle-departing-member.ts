// Runs right before a HouseholdMember row is deleted, so the split bills it
// leaves behind don't quietly regress. TransactionSplit.householdMember is
// onDelete: Cascade (see its doc comment in prisma/schema.prisma), so
// deleting a membership also deletes that member's own split row on every
// transaction they were part of — including whatever they'd actually paid
// (TransactionSplit.amountPaid). Left alone, that erases the payment: the
// bill's remainingDue jumps back up (see settle-up-calc.ts) and the other
// members' now-unmatched shares turn into owedToBill, so a bill that was
// genuinely paid looks unpaid again. Migration
// 20260925050231_partial_payments_and_settlements's backfill 3 fixed exactly
// this for historical rows (a payer who'd already left when that migration
// ran) by marking every remaining member as having paid their own share.
// This mirrors that same rule going forward, called from inside the same
// $transaction as the membership delete so it's atomic with it.
//
// Deliberately unconditional, same as backfill 3: it doesn't try to work out
// whether the departing member actually paid anything on a given bill
// (amountPaid on their own split row, about to be lost, isn't distinguished
// from a member who only owed money) — every other member's share on a bill
// the departing member was part of is marked paid. That's the same
// known-simplification tradeoff TransactionSplit.householdMember's Cascade
// doc comment already accepts.
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

export async function settleDepartingMemberSplits(
  tx: typeof prisma | Prisma.TransactionClient,
  memberId: string,
): Promise<void> {
  const otherMembersSplits = await tx.transactionSplit.findMany({
    where: {
      householdMemberId: { not: memberId },
      transaction: { splits: { some: { householdMemberId: memberId } } },
    },
    select: { id: true, amountOwed: true },
  });

  await Promise.all(
    otherMembersSplits.map((split) =>
      tx.transactionSplit.update({
        where: { id: split.id },
        data: { amountPaid: split.amountOwed },
      }),
    ),
  );
}
