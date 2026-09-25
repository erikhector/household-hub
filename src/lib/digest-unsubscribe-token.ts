import { createHmac, timingSafeEqual } from "crypto";

// Signed, login-free unsubscribe token for the weekly digest email (GAP-27).
// `<userId>.<base64url HMAC-SHA256>` — the user id is readable (it's an
// opaque cuid, not an email address), the signature is what makes the link
// unforgeable: without it, anyone could switch off anyone's digest by
// guessing ids.
//
// Keyed on AUTH_SECRET rather than a new env var: it's already a required,
// high-entropy, server-only secret in every deployment, and the "purpose"
// prefix below keeps these signatures from ever being interchangeable with
// anything Auth.js itself derives from the same secret. Rotating
// AUTH_SECRET invalidates outstanding unsubscribe links, which is harmless:
// the next digest carries a fresh one, and the Profile toggle always works.
//
// Stateless and non-expiring on purpose. Unsubscribe links are expected to
// keep working in an email read weeks later, and the worst a leaked link can
// do is turn one person's digest *off*.
const PURPOSE = "squirrel:weekly-digest-unsubscribe:v1";

function sign(userId: string, secret: string): string {
  return createHmac("sha256", secret).update(`${PURPOSE}:${userId}`).digest("base64url");
}

export function createDigestUnsubscribeToken(userId: string, secret: string): string {
  return `${userId}.${sign(userId, secret)}`;
}

/** The user id the token was issued for, or null if it's malformed or the
 * signature doesn't match. */
export function verifyDigestUnsubscribeToken(token: unknown, secret: string | undefined): string | null {
  if (!secret || typeof token !== "string" || token.length > 256) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(userId, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return userId;
}
