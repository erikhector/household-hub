"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import type { ActionState } from "@/lib/actions/auth";
import { fail, toFriendlyError, v, zodFail } from "@/lib/actions/errors";
import { revalidateBudgetPages } from "./action-helpers";
import { normalizeMoney } from "@/lib/decimal-input";

// --- Settling up between members ---------------------------------------------
// See MemberSettlement's doc comment in schema.prisma and HouseholdBalances
// ("Clear debt"). Balances carry over between months until one of these
// clears them.

const settlementSchema = z.object({
  fromMemberId: z.string().min(1, v("chooseWhoPaid")),
  toMemberId: z.string().min(1, v("chooseWhoWasPaid")),
  amount: z.coerce.number({ error: v("amountFormat") }).positive(v("amountPositive")),
  date: z.string().min(1, v("dateRequired")),
});

/**
 * Records that one member paid another back ("Clear debt"). A form action:
 * the dialog pre-fills the suggested transfer from simplifyDebts, and the
 * amount can be lowered for a partial repayment. Both members are
 * re-checked against the caller's own household — never trusted from the
 * client — and the amount isn't capped at the current debt, since a
 * rounded-up repayment is a real thing that happens; any excess simply
 * shows up as a balance in the other direction.
 */
export async function recordSettlementAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household, userId } = await requireHousehold();

  const parsed = settlementSchema.safeParse({
    fromMemberId: formData.get("fromMemberId"),
    toMemberId: formData.get("toMemberId"),
    amount: normalizeMoney(formData.get("amount")),
    date: formData.get("date"),
  });
  if (!parsed.success) {
    return zodFail(parsed.error);
  }
  if (parsed.data.fromMemberId === parsed.data.toMemberId) {
    return fail("chooseTwoDifferentMembers");
  }

  const members = await prisma.householdMember.findMany({
    where: {
      id: { in: [parsed.data.fromMemberId, parsed.data.toMemberId] },
      householdId: household.id,
    },
    select: { id: true },
  });
  if (members.length !== 2) {
    return fail("splitMemberGone");
  }

  try {
    await prisma.memberSettlement.create({
      data: {
        householdId: household.id,
        fromMemberId: parsed.data.fromMemberId,
        toMemberId: parsed.data.toMemberId,
        amount: parsed.data.amount,
        date: new Date(parsed.data.date),
        createdByUserId: userId,
      },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidateBudgetPages();
  return {};
}

/** Undoes a recorded repayment (e.g. entered by mistake). */
export async function deleteSettlementAction(settlementId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  try {
    await prisma.memberSettlement.deleteMany({
      where: { id: settlementId, householdId: household.id },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidateBudgetPages();
  return {};
}
