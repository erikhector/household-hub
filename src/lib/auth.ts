import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/lib/auth.config";
import { checkRateLimit } from "@/lib/rate-limit";
import { hashToken } from "@/lib/token-hash";
import { redeemEmailVerificationToken } from "@/lib/email-verification";

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

// UX-135: the verification link signs the new user in. Same ceiling as
// VERIFY_EMAIL_RATE_LIMIT in src/lib/actions/auth.ts, but enforced here for
// the reason LOGIN_RATE_LIMIT is: Auth.js accepts
// `POST /api/auth/callback/verification-link` directly.
const VERIFICATION_LINK_RATE_LIMIT = 10;
const VERIFICATION_LINK_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

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
    // UX-135: the emailed verification token is the credential. It is the
    // same secret that already lets its holder mark the address verified, so
    // signing in with it adds no new trust: it must be unused and unexpired,
    // and is spent here in one transaction (a replay finds it used and gets
    // null). Only a never-verified account qualifies, so a leftover link
    // can't become a password-free way back in later.
    Credentials({
      id: "verification-link",
      credentials: { token: { label: "Token", type: "text" } },
      authorize: async (credentials) => {
        const token = credentials?.token;
        if (typeof token !== "string" || token === "") return null;
        const hashed = hashToken(token);

        if (
          !(await checkRateLimit(
            `verification-link:${hashed}`,
            VERIFICATION_LINK_RATE_LIMIT,
            VERIFICATION_LINK_RATE_LIMIT_WINDOW_MS,
          ))
        ) {
          throw new RateLimitedSignin();
        }

        const record = await prisma.emailVerificationToken.findUnique({
          where: { token: hashed },
          include: { user: true },
        });
        if (!record || record.usedAt || record.expiresAt < new Date()) return null;
        if (record.user.emailVerifiedAt) return null;

        const redeemed = await prisma.$transaction((tx) => redeemEmailVerificationToken(tx, record));
        if (!redeemed) return null;

        return {
          id: record.user.id,
          email: record.user.email,
          name: record.user.displayName,
          passwordChangedAt: record.user.passwordChangedAt,
        };
      },
    }),
  ],
});
