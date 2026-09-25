import "server-only";
import { prisma } from "@/lib/prisma";
import { verifyDigestUnsubscribeToken } from "@/lib/digest-unsubscribe-token";

export type DigestUnsubscribeResult = "unsubscribed" | "invalid";

// Shared by both unsubscribe entry points — the RFC 8058 one-click POST that
// mail clients send (src/app/api/digest/unsubscribe/[token]/route.ts) and
// the /unsubscribe/[token] page a person lands on from the email's footer
// link (unsubscribeFromDigestAction in src/lib/actions/digest.ts). The
// signed token is the only authorization: no session is involved, which is
// the point of an unsubscribe link.
//
// updateMany rather than update: a token for an account deleted since the
// email went out matches no row, which should read as "done", not throw.
// Idempotent — unsubscribing twice is just a second no-op write.
export async function unsubscribeFromDigestByToken(token: unknown): Promise<DigestUnsubscribeResult> {
  const userId = verifyDigestUnsubscribeToken(token, process.env.AUTH_SECRET);
  if (!userId) return "invalid";
  await prisma.user.updateMany({ where: { id: userId }, data: { weeklyDigestEnabled: false } });
  return "unsubscribed";
}
