import { prisma } from "@/lib/prisma";

// Amounts within this tolerance of the total are accepted — guards against
// floating point noise (e.g. splitting 10 three ways), not a real mismatch.
// Lives here (not in a "use server" actions file) because every export of a
// "use server" file becomes a callable Server Action.
export const SPLIT_SUM_TOLERANCE = 0.01;

/**
 * Parses the optional "split this bill" section of a form that records
 * expected shares without a "paid by" member (RecurringTemplateDialog, the
 * planned-bill dialog): repeated `splitMemberId` / `splitAmount` inputs behind
 * a `splitEnabled` checkbox. Same convention and validation as the
 * transaction form's parseSplitFormData, minus "paid by": a template or
 * planned bill is never itself "paid", only its expected shares matter (see
 * prisma/schema.prisma's RecurringTemplateSplit doc comment). Returns `null`
 * when splitting wasn't requested, so a plain template is completely
 * unaffected — no retroactive backfill for existing templates either way.
 * `sumMismatchError` is the message shown when the shares don't add up, so
 * each caller can name its own thing ("template's amount", "bill's amount").
 */
export async function parseShareSplitFormData(
  formData: FormData,
  householdId: string,
  amount: number,
  sumMismatchError: string,
): Promise<{ error: string } | { householdMemberId: string; amountOwed: number }[] | null> {
  if (formData.get("splitEnabled") !== "on") return null;

  const memberIds = formData.getAll("splitMemberId").map((v) => String(v));
  const amounts = formData.getAll("splitAmount").map((v) => Number(v));
  if (memberIds.length === 0 || memberIds.length !== amounts.length) {
    return { error: "Invalid split" };
  }
  if (amounts.some((a) => Number.isNaN(a) || a < 0)) {
    return { error: "Each split amount must be zero or more" };
  }

  const validMembers = await prisma.householdMember.findMany({
    where: { id: { in: memberIds }, householdId },
    select: { id: true },
  });
  if (validMembers.length !== new Set(memberIds).size) {
    return { error: "One of the selected members no longer belongs to this household" };
  }

  const splitTotal = amounts.reduce((sum, a) => sum + a, 0);
  if (Math.abs(splitTotal - amount) > SPLIT_SUM_TOLERANCE) {
    return { error: sumMismatchError };
  }

  return memberIds.map((householdMemberId, i) => ({ householdMemberId, amountOwed: amounts[i] }));
}
