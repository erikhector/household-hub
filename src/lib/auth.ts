import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/lib/auth.config";
import { checkRateLimit } from "@/lib/rate-limit";
import { hashToken } from "@/lib/token-hash";
import { redeemVerificationToken } from "@/lib/verification-redeem";

// Thrown from `authorize` below once the password checks out but the
// account's email is still unverified — lets loginAction (src/lib/actions/
// auth.ts) show "verify your email" instead of the generic "invalid
// credentials" message. Only reachable after a correct password, so it
// never leaks verification status to someone who doesn't already know the
// account's password.
export class EmailNotVerifiedSignin extends CredentialsSignin {
  code = "email-not-verified";
}

// Thrown from `authorize` below when the per-email login throttle trips
// (see LOGIN_RATE_LIMIT). A distinguishable CredentialsSignin subclass,
// same pattern as EmailNotVerifiedSignin above, so loginAction (src/lib/
// actions/auth.ts) can show its own "too many attempts" copy instead of
// the generic "invalid credentials" message that every other `authorize`
// failure gets.
export class RateLimitedSignin extends CredentialsSignin {
  code = "rate-limited";
}

// No account lockout (that would let anyone lock a stranger out just by
// typing their email + wrong passwords) — instead this throttles how many
// credential guesses any single email address can absorb per window,
// regardless of source IP. Bcrypt's own cost factor already slows a single
// guess down; this bounds how many guesses get that far at all. See
// src/lib/rate-limit.ts for why this is a speed bump, not a hard guarantee.
//
// Lives here (not in src/lib/actions/auth.ts) and is enforced inside
// `authorize` itself — see SEC-1 in REQUIREMENTS.md's "Login rate
// limiting" section — because Auth.js also accepts
// `POST /api/auth/callback/credentials` directly, which calls `authorize`
// without ever going through loginAction. Checking only in loginAction left
// that endpoint free to guess passwords without limit.
const LOGIN_RATE_LIMIT = 10;
const LOGIN_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

// UX-135: same per-token budget verifyEmailAction applies, repeated here
// because Auth.js also accepts POST /api/auth/callback/verification-link
// directly, which never goes through that action.
const VERIFY_LINK_RATE_LIMIT = 10;
const VERIFY_LINK_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const rawEmail = credentials?.email;
        const password = credentials?.password;
        if (typeof rawEmail !== "string" || typeof password !== "string") {
          return null;
        }
        // loginAction's Zod schema already trims + lowercases before it
        // calls signIn, but this endpoint is also reachable straight from
        // Auth.js's own /api/auth/callback/credentials, which never runs
        // that schema — normalize here too so both paths rate-limit and
        // look up the same bucket/row for "Erik@Example.com" and
        // "erik@example.com".
        const email = rawEmail.trim().toLowerCase();

        // Checked before the user lookup and bcrypt.compare below, and
        // regardless of whether the account exists, so a throttled
        // attempt never pays either cost and never gets a timing
        // difference to learn from.
        if (!(await checkRateLimit(`login:${email}`, LOGIN_RATE_LIMIT, LOGIN_RATE_LIMIT_WINDOW_MS))) {
          throw new RateLimitedSignin();
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        if (!user.emailVerifiedAt) throw new EmailNotVerifiedSignin();

        return {
          id: user.id,
          email: user.email,
          name: user.displayName,
          passwordChangedAt: user.passwordChangedAt,
        };
      },
    }),
    // UX-135: a valid, unused, unexpired email-verification link signs the
    // user in (same trust as a password-reset link, which proves the same
    // inbox). The proof is the emailed raw token, never a user id, so this
    // endpoint can't be used to sign in as someone by guessing an id. The
    // token is spent here, in the same atomic claim that verifies the email
    // (redeemVerificationToken), so the link signs in exactly once; an
    // expired, used or unknown token returns null and the caller falls back
    // to today's "log in" behaviour. No password is involved, so
    // EmailNotVerifiedSignin can't apply: redeeming is what verifies.
    Credentials({
      id: "verification-link",
      credentials: { token: { label: "Token", type: "text" } },
      authorize: async (credentials) => {
        const token = credentials?.token;
        if (typeof token !== "string" || !token) return null;

        if (
          !(await checkRateLimit(
            `verify-link:${token}`,
            VERIFY_LINK_RATE_LIMIT,
            VERIFY_LINK_RATE_LIMIT_WINDOW_MS,
          ))
        ) {
          throw new RateLimitedSignin();
        }

        const row = await prisma.emailVerificationToken.findUnique({
          where: { token: hashToken(token) },
          include: { user: true },
        });
        if (!row || row.usedAt || row.expiresAt < new Date()) return null;
        // Already verified: nothing to prove by this link, so it doesn't
        // sign in (a stale second link must not become a login).
        if (row.user.emailVerifiedAt) return null;

        if (!(await redeemVerificationToken(row.id, row.userId))) return null;

        return {
          id: row.user.id,
          email: row.user.email,
          name: row.user.displayName,
          passwordChangedAt: row.user.passwordChangedAt,
        };
      },
    }),
  ],
});
