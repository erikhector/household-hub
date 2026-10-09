import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/token-hash";

// UX-28: whether a /reset-password/<token> link can still be redeemed, so
// the page can show an "invalid or expired link" card instead of a full
// form that only fails after the user has typed a new password. Same three
// conditions resetPasswordAction enforces on submit (exists, unused,
// unexpired), which stays the authority: this is a read-only courtesy check
// and writes nothing. It lives outside src/lib/actions/auth.ts because every
// export of a "use server" file becomes a client-callable endpoint.
export async function isPasswordResetTokenUsable(token: string): Promise<boolean> {
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { token: hashToken(token) },
    select: { usedAt: true, expiresAt: true },
  });
  return Boolean(resetToken && !resetToken.usedAt && resetToken.expiresAt >= new Date());
}
