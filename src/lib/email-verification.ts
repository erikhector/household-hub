import type { Prisma } from "@/generated/prisma/client";

/**
 * Marks one email-verification token used and its user verified, in the
 * caller's transaction. Returns false when someone else claimed the token
 * first (SEC-8: the `usedAt: null` condition makes the claim atomic, so two
 * concurrent clicks of one link can't both redeem it).
 *
 * Shared by verifyEmailAction (a visitor who is already signed in) and the
 * `verification-link` sign-in provider in src/lib/auth.ts (UX-135), so the
 * two ways of redeeming a link can never drift apart.
 */
export async function redeemEmailVerificationToken(
  tx: Prisma.TransactionClient,
  token: { id: string; userId: string },
): Promise<boolean> {
  const claimed = await tx.emailVerificationToken.updateMany({
    where: { id: token.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) return false;
  await tx.user.update({
    where: { id: token.userId },
    data: { emailVerifiedAt: new Date() },
  });
  // Same reasoning as resetPasswordAction invalidating other reset tokens on
  // success: an older leaked/unused link for this user should stop working
  // once verification has actually gone through.
  await tx.emailVerificationToken.deleteMany({
    where: { userId: token.userId, usedAt: null, id: { not: token.id } },
  });
  return true;
}
