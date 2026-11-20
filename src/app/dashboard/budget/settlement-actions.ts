"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import type { ActionState } from "@/lib/actions/auth";
import { toFriendlyError } from "@/lib/actions/errors";
import { revalidateBudgetPages } from "./action-helpers";

// --- Settling up between members ---------------------------------------------
// See MemberSettlement's doc comment in schema.prisma and HouseholdBalances
// ("Clear debt"). Balances carry over between months until one of these
// clears them.

const settlementSchema = z.object({
  fromMemberId: z.string().min(1, "Choose who paid"),
  toMemberId: z.string().min(1, "Choose who was paid"),
  amount: z.coerce.number().positive("Amount must be greater than 0"),
  date: z.string().min(1, "Date is required"),
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
    amount: formData.get("amount"),
    date: formData.get("date"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  if (parsed.data.fromMemberId === parsed.data.toMemberId) {
    return { error: "Choose two different members" };
  }

  const members = await prisma.householdMember.findMany({
    where: {
      id: { in: [parsed.data.fromMemberId, parsed.data.toMemberId] },
      householdId: household.id,
    },
    select: { id: true },
  });
  if (members.length !== 2) {
    return { error: "One of the selected members no longer belongs to this household" };
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
