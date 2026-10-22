import { prisma } from "@/lib/prisma";

/**
 * Atomically redeems one email-verification token: claims it (single use,
 * SEC-8), marks the user verified and drops the user's other unused
 * verification links. Returns false when another request claimed the token
 * first. Shared by `verifyEmailAction` (a visitor who is already signed in)
 * and the `verification-link` provider in src/lib/auth.ts (UX-135, which
 * signs the user in with the same single claim), so there is exactly one
 * place that spends a verification token.
 */
export async function redeemVerificationToken(tokenId: string, userId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    // SEC-8: claim the token atomically (see resetPasswordAction).
    const claimed = await tx.emailVerificationToken.updateMany({
      where: { id: tokenId, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) return false;
    await tx.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    // Same reasoning as resetPasswordAction invalidating other reset tokens
    // on success: an older leaked/unused link for this user should stop
    // working once verification has actually gone through.
    await tx.emailVerificationToken.deleteMany({
      where: { userId, usedAt: null, id: { not: tokenId } },
    });
    return true;
  });
}
